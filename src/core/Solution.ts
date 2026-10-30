import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { SolutionFolderEditor, SolutionEditHost } from './solutionFolderEditor';
import { renameProjectInSln, renameProjectInSlnx, retargetProjectReferences } from '../parsers/projectRename';
import { SolutionFile, SolutionProject } from '../types/solution';
import { ISolutionFileHandler, createSolutionFileHandler } from '../handlers';
import { DebugConfigService } from '../services/debug/debugConfigService';
import { StartupChoice } from '../services/debug/startupProfiles/startupChoice';
import { configurationProjectsOf, readConfigurationModel } from '../services/build/configurationManager/configurationManager';
import { ConfigurationModel } from '../services/build/configurationManager/model';
import { Project } from './Project';
import { logger } from './logger';
import { SimpleDebounceManager } from '../services/shared/debounceManager';
import { workspaceFolderOf } from '../services/solution/workspaceFolders';
import { UnloadedProjects } from '../services/solution/unloadedProjects';
import { pathKey } from '../services/project/items/projectItems';

export interface SolutionFileTreeNode {
    name: string;
    type: 'solutionFolder' | 'file';
    files?: SolutionFileItem[];
}

export type { SolutionNodeMove } from './solutionFolderEditor';

export interface SolutionFileItem {
    name: string;
    path: string;
    relativePath: string;
}

/** Line ending used by the file, so line-based edits don't mix CRLF and LF */
const eolOf = (content: string) => content.includes('\r\n') ? '\r\n' : '\n';

const log = logger('Solution');

export class Solution {
    private _disposables: vscode.Disposable[] = [];
    private _changeEmitter = new vscode.EventEmitter<void>();
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _launchJsonWatcher?: vscode.FileSystemWatcher;
    private _solutionFile?: SolutionFile;
    private _solutionText = '';
    private _configurationModel?: ConfigurationModel;
    private _projects: Map<string, Project> = new Map();
    private _fileTree: Record<string, SolutionFileTreeNode> = {}; // Solution files tree structure
    private _isInitialized = false;
    private _handler: ISolutionFileHandler;

    // Cached startup project and framework from launch.json
    private _cachedStartupProject: string | null = null;
    private _cachedFramework: string | null = null;

    // Debounce manager for launch.json changes
    private _launchJsonDebouncer: SimpleDebounceManager;

    public readonly onDidChange = this._changeEmitter.event;

    private _parseEmitter = new vscode.EventEmitter<void>();
    /**
     * Fires after the solution file was read again (it changed on disk, or an edit of the extension wrote it), unlike
     * `onDidChange`, which also fires for launch.json and project changes. For what depends on the project list only.
     */
    public readonly onDidParse = this._parseEmitter.event;

    /** Settles when the solution is loaded; rejects with the reason if it could not be loaded */
    public readonly ready: Promise<void>;

    private readonly _folders = new SolutionFolderEditor(this.editHost());

    constructor(private readonly _solutionPath: string) {
        // Create the appropriate file handler based on file extension
        this._handler = createSolutionFileHandler(_solutionPath);
        // Initialize debouncer for launch.json changes
        this._launchJsonDebouncer = new SimpleDebounceManager(async () => {
            log.debug('launch.json changed, refreshing startup project and framework cache...');

            try {
                await this.refreshLaunchJsonCache();

                // Notify UI that solution has changed (this will trigger tree refresh)
                log.debug('Firing solution change event to notify UI...');
                this._changeEmitter.fire();
            } catch (error) {
                log.error('Error handling launch.json change:', error);
            }
        }, 100);

        this.ready = this.initialize();
        // Callers that need the outcome await `ready`; don't report an unhandled rejection meanwhile
        this.ready.catch(() => undefined);
    }

    /** What the folder editor needs of this solution */
    private editHost(): SolutionEditHost {
        return {
            handler: () => this._handler,
            solutionFile: () => this._solutionFile,
            solutionPath: () => this._solutionPath,
            isSlnx: () => this.isSlnx,
            parse: () => this.parseSolutionFile(),
            editSlnx: edit => this.editSlnx(edit),
            editSlnLines: edit => this.editSlnLines(edit),
            getSolutionItems: project => this.getSolutionItems(project),
        };
    }

    get solutionPath(): string {
        return this._solutionPath;
    }

    get solutionFile(): SolutionFile | undefined {
        return this._solutionFile;
    }

    get projects(): Map<string, Project> {
        return this._projects;
    }

    get fileTree(): Record<string, SolutionFileTreeNode> {
        return this._fileTree;
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    private async initialize(): Promise<void> {
        try {
            // Set up file watcher for the solution file
            this.setupFileWatcher();

            // Set up file watcher for launch.json
            this.setupLaunchJsonWatcher();

            // A reloaded project was not evaluated by MSBuild while unloaded (the others return their cached list)
            this._disposables.push(UnloadedProjects.onDidChange(() => {
                for (const project of this._projects.values()) {
                    void project.evaluateItems();
                }
            }));

            // Parse the solution file initially
            await this.parseSolutionFile();

            // Initialize projects
            await this.initializeProjects();

            // Load initial startup project and framework from launch.json
            await this.refreshLaunchJsonCache();

            this._isInitialized = true;
            log.info(`Initialized solution: ${path.basename(this._solutionPath)}`);
        } catch (error) {
            log.error('Failed to initialize solution:', error);
            throw error;
        }
    }

    private setupFileWatcher(): void {
        // Watch the solution file for changes
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(this._solutionPath);

        this._fileWatcher.onDidChange(this.handleSolutionFileChanged, this, this._disposables);
        this._fileWatcher.onDidDelete(this.handleSolutionFileDeleted, this, this._disposables);

        this._disposables.push(this._fileWatcher);
    }

    private setupLaunchJsonWatcher(): void {
        // Get workspace folder to watch launch.json
        const workspaceFolder = workspaceFolderOf(this._solutionPath);
        if (!workspaceFolder) {
            log.warn('No workspace folder found, cannot watch launch.json');
            return;
        }

        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');

        // Watch the launch.json file for changes
        this._launchJsonWatcher = vscode.workspace.createFileSystemWatcher(launchJsonPath);

        this._launchJsonWatcher.onDidChange(this.handleLaunchJsonChanged, this, this._disposables);
        this._launchJsonWatcher.onDidCreate(this.handleLaunchJsonChanged, this, this._disposables);
        this._launchJsonWatcher.onDidDelete(this.handleLaunchJsonDeleted, this, this._disposables);

        this._disposables.push(this._launchJsonWatcher);
    }

    private async handleLaunchJsonChanged(): Promise<void> {
        log.debug('launch.json change detected, debouncing...');
        this._launchJsonDebouncer.trigger();
    }

    private handleLaunchJsonDeleted(): void {
        log.debug('launch.json deleted, clearing cache');
        this._cachedStartupProject = null;
        this._cachedFramework = null;

        // Notify UI that solution has changed
        this._changeEmitter.fire();
    }

    private async refreshLaunchJsonCache(): Promise<void> {
        try {
            log.debug('Calling DebugConfigService.getStartupProject()...');
            const startupProject = DebugConfigService.getStartupProject();
            log.debug(`DebugConfigService returned startup project: ${startupProject}`);

            const framework = DebugConfigService.getActiveFramework();
            log.debug(`DebugConfigService returned framework: ${framework}`);

            this._cachedStartupProject = startupProject;
            this._cachedFramework = framework;

            log.debug(`Refreshed launch.json cache - startup project: ${startupProject}, framework: ${framework}`);
            log.debug(`Cached startup project is now: ${this._cachedStartupProject}`);
        } catch (error) {
            log.error('Error refreshing launch.json cache:', error);
            this._cachedStartupProject = null;
            this._cachedFramework = null;
        }
    }

    private async handleSolutionFileChanged(): Promise<void> {
        log.debug('Solution file changed, reparsing...');

        try {
            await this.parseSolutionFile();
            await this.initializeProjects(true);

            // Notify UI that solution has changed
            this._changeEmitter.fire();

        } catch (error) {
            log.error('Error handling solution file change:', error);
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(`Could not reload ${path.basename(this._solutionPath)}: ${reason}`);
        }
    }

    private handleSolutionFileDeleted(): void {
        log.debug('Solution file deleted');
        this.dispose();
    }

    private async parseSolutionFile(): Promise<void> {
        try {
            const solutionContent = await this._handler.read();
            this._solutionFile = await this._handler.parse(solutionContent);
            this._solutionText = solutionContent;
            this._configurationModel = undefined;

            // Build file tree for solution folders and solution items
            this.buildSolutionFileTree();

            log.debug(`Parsed solution with ${this._solutionFile.projects.length} projects`);
            this._parseEmitter.fire();
        } catch (error) {
            log.error('Error parsing solution file:', error);
            throw error;
        }
    }

    private buildSolutionFileTree(): void {
        if (!this._solutionFile) return;

        this._fileTree = {};

        // Build tree structure from solution folders
        for (const project of this._solutionFile.projects) {
            if (SolutionFileParser.isSolutionFolder(project)) {
                const solutionItems = SolutionFileParser.getSolutionItems(project);
                if (solutionItems.length > 0) {
                    this._fileTree[project.guid] = {
                        name: project.name,
                        type: 'solutionFolder',
                        files: solutionItems.map(item => ({
                            name: path.basename(item),
                            path: path.resolve(path.dirname(this._solutionPath), item),
                            relativePath: item
                        }))
                    };
                }
            }
        }
    }

    /**
     * Creates the projects of the parsed solution file. `keepExisting`: after the solution file changed on disk (git pull,
     * `dotnet sln add` in a terminal) only the projects that were added or removed (or renamed) are created or disposed;
     * the others keep their items, watchers and expansion state.
     */
    private async initializeProjects(keepExisting = false): Promise<void> {
        if (!this._solutionFile) return;

        const wanted = new Map<string, string>();
        for (const solutionProject of this._solutionFile.projects) {
            if (SolutionFileParser.isDotNetProject(solutionProject)) {
                wanted.set(path.resolve(path.dirname(this._solutionPath), solutionProject.path), solutionProject.name);
            }
        }
        for (const [projectPath, project] of [...this._projects]) {
            if (keepExisting && wanted.get(projectPath) === project.name) {
                continue;
            }
            project.dispose();
            this._projects.delete(projectPath);
        }

        // Initialize new projects and wait for them to be ready
        const projectPromises: Promise<void>[] = [];

        for (const solutionProject of this._solutionFile.projects) {
            if (SolutionFileParser.isDotNetProject(solutionProject)) {
                const absolutePath = path.resolve(path.dirname(this._solutionPath), solutionProject.path);
                if (this._projects.has(absolutePath)) {
                    continue; // kept
                }

                try {
                    const project = new Project(absolutePath, solutionProject, () => UnloadedProjects.isUnloaded(this._solutionPath, absolutePath),
                        () => [...this._projects.keys()]);

                    // Subscribe to project changes
                    project.onDidChange(() => {
                        log.debug(`Project ${project.name} changed, forwarding to solution`);
                        this._changeEmitter.fire(); // Forward to solution listeners
                    });

                    this._projects.set(absolutePath, project);

                    // Wait for project initialization
                    const projectInitPromise = this.waitForProjectInitialization(project, solutionProject.name);
                    projectPromises.push(projectInitPromise);
                } catch (error) {
                    log.error(`Failed to initialize project ${solutionProject.name}:`, error);
                }
            }
        }

        // Wait for all projects to initialize
        await Promise.all(projectPromises);
        log.debug(`All ${projectPromises.length} projects initialized`);
    }

    /**
     * Waits for a project to finish initializing
     */
    private async waitForProjectInitialization(project: Project, projectName: string): Promise<void> {
        let retries = 0;
        while (!project.isInitialized && retries < 50) { // Wait up to 5 seconds
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }

        if (project.isInitialized) {
            log.debug(`Project ${projectName} initialized successfully`);
        } else {
            log.warn(`Project ${projectName} initialization timed out`);
        }
    }

    /** The length of `dir` when `target` is `dir` or inside it (compared whole path segments, case-insensitive where the file system is), else undefined */
    private static containedIn(target: string, dir: string): number | undefined {
        const targetKey = pathKey(path.normalize(target));
        const dirKey = pathKey(path.normalize(dir)).replace(/[\\/]+$/, '');
        if (targetKey === dirKey) {
            return dirKey.length;
        }
        return targetKey.startsWith(dirKey) && /[\\/]/.test(targetKey.charAt(dirKey.length)) ? dirKey.length : undefined;
    }

    /**
     * Gets a project by its file path
     */
    getProject(projectPath: string): Project | undefined {
        log.debug(`getProject called with: ${projectPath}`);
        log.debug(`Available project paths:`, Array.from(this._projects.keys()));

        const project = this._projects.get(projectPath);
        if (!project) {
            // Try to find by matching project file name instead of full path
            for (const [storedPath, proj] of this._projects) {
                if (storedPath === projectPath || proj.projectPath === projectPath) {
                    log.debug(`Found project by alternate matching: ${proj.name}`);
                    return proj;
                }
            }

            // A folder or file inside a project's folder: the innermost project folder that contains it. The name
            // alone is not enough: the folder of "Foo.Tests" starts with the folder of "Foo" without being inside it
            let best: { project: Project; length: number } | undefined;
            for (const [storedPath, proj] of this._projects) {
                for (const dir of new Set([path.dirname(storedPath), path.dirname(proj.projectPath)])) {
                    const length = Solution.containedIn(projectPath, dir);
                    if (length !== undefined && (!best || length > best.length)) {
                        best = { project: proj, length };
                    }
                }
            }
            if (best) {
                log.debug(`Found project by parent matching: ${best.project.name}`);
                return best.project;
            }
            log.debug(`No project found for path: ${projectPath}`);
        } else {
            log.debug(`Found project: ${project.name}`);
        }

        return project;
    }

    /**
     * Gets all .NET projects (excluding solution folders)
     */
    getDotNetProjects(): Project[] {
        return Array.from(this._projects.values());
    }

    /**
     * Gets solution folders from the solution file
     */
    getSolutionFolders(): SolutionProject[] {
        if (!this._solutionFile) return [];
        return this._solutionFile.projects.filter(p => SolutionFileParser.isSolutionFolder(p));
    }

    /**
     * Gets solution items for a solution folder
     */
    getSolutionItems(project: SolutionProject): string[] {
        return SolutionFileParser.getSolutionItems(project);
    }

    /**
     * Checks if a project is a solution folder
     */
    isSolutionFolder(project: SolutionProject): boolean {
        return SolutionFileParser.isSolutionFolder(project);
    }

    /**
     * Checks if a project is a .NET project
     */
    isDotNetProject(project: SolutionProject): boolean {
        return SolutionFileParser.isDotNetProject(project);
    }

    private get isSlnx(): boolean {
        return this._handler.fileType === '.slnx';
    }

    /**
     * Applies a text edit to the .slnx file and re-parses it
     */
    private async editSlnx(edit: (content: string) => string): Promise<void> {
        await this.editSolutionText(edit);
    }

    /**
     * Reads the solution file's text, writes what `edit` returns and re-parses it, so the model is fresh on return
     */
    async editSolutionText(edit: (content: string, type: 'sln' | 'slnx') => string): Promise<void> {
        await this.queueEdit(async () => {
            const content = await this._handler.read();
            await this._handler.write(edit(content, this.isSlnx ? 'slnx' : 'sln'));
            await this.parseSolutionFile();
        });
    }

    private _editQueue: Promise<unknown> = Promise.resolve();

    /** Runs the edit after the ones before it have finished: two quick edits must not read the same text and lose one */
    private queueEdit<T>(operation: () => Promise<T>): Promise<T> {
        const result = this._editQueue.then(operation, operation);
        this._editQueue = result.catch(() => undefined);
        return result;
    }

    /**
     * The solution file's projects (not solution folders), as the configuration code identifies them
     */
    get configurationProjects(): Array<{ path: string; guid: string }> {
        return configurationProjectsOf(this._solutionFile);
    }

    /**
     * The solution's configurations, platforms and project mappings, read from the text of the last parse
     */
    get configurationModel(): ConfigurationModel {
        this._configurationModel ??= readConfigurationModel(this.isSlnx ? 'slnx' : 'sln', this._solutionText, this.configurationProjects);
        return this._configurationModel;
    }

    /** Reads the .sln, applies a line edit, writes it with the file's line endings and re-parses */
    private async editSlnLines(edit: (lines: string[]) => string[]): Promise<void> {
        await this.queueEdit(async () => {
            const content = await this._handler.read();
            await this._handler.write(edit(content.split(/\r?\n/)).join(eolOf(content)));
            await this.parseSolutionFile();
        });
    }

    /**
     * Adds a project to the solution file, at the root or into a solution folder (`Libs/Inner`).
     * Like Visual Studio, a project added at the root stays there; `dotnet sln add` alone would
     * create solution folders mirroring the project's directories.
     */
    async addProject(projectPath: string, solutionFolderPath?: string): Promise<void> {
        log.debug(`Adding project to solution: ${projectPath}${solutionFolderPath ? ` (folder ${solutionFolderPath})` : ''}`);

        try {
            const solutionDir = path.dirname(this._solutionPath);
            const args = [
                'sln', this._solutionPath, 'add', path.relative(solutionDir, projectPath),
                ...(solutionFolderPath ? ['--solution-folder', solutionFolderPath] : ['--in-root'])
            ];
            log.debug(`Executing: dotnet ${args.join(' ')}`);

            const { execFile } = require('child_process');
            const { promisify } = require('util');
            await promisify(execFile)('dotnet', args, { cwd: solutionDir, timeout: 60000 });

            log.debug(`Successfully added project to solution: ${projectPath}`);

            // Re-parse the solution file and re-initialize projects
            await this.parseSolutionFile();
            await this.initializeProjects();

        } catch (error) {
            log.error(`Error adding project to solution:`, error);
            throw error;
        }
    }

    /**
     * Renames a project file (not its folder) like Visual Studio: the solution entry keeps its GUID and
     * solution folder, and the other projects' references follow. Returns the new project file.
     */
    async renameProject(projectPath: string, newName: string): Promise<string> {
        const name = newName.trim();
        if (!name || /[\\/:*?"<>|]/.test(name)) {
            throw new Error(`Invalid project name "${newName}"`);
        }
        const newPath = path.join(path.dirname(projectPath), name + path.extname(projectPath));
        if (newPath === projectPath) {
            return projectPath;
        }
        if (fs.existsSync(newPath) && newPath.toLowerCase() !== projectPath.toLowerCase()) {
            throw new Error(`${path.basename(newPath)} already exists`);
        }
        const solutionDir = path.dirname(this._solutionPath);
        const relative = (file: string) => path.relative(solutionDir, file).split(path.sep).join('/');

        await fs.promises.rename(projectPath, newPath);
        await this.queueEdit(async () => {
            const content = await this._handler.read();
            await this._handler.write(this.isSlnx
                ? renameProjectInSlnx(content, relative(projectPath), relative(newPath))
                : renameProjectInSln(content, relative(projectPath), relative(newPath), name));
        });

        for (const project of this.getDotNetProjects()) {
            if (project.projectPath === projectPath || !fs.existsSync(project.projectPath)) {
                continue;
            }
            const xml = await fs.promises.readFile(project.projectPath, 'utf8');
            const updated = retargetProjectReferences(xml, path.dirname(project.projectPath), projectPath, newPath);
            if (updated !== xml) {
                await fs.promises.writeFile(project.projectPath, updated, 'utf8');
            }
        }

        log.debug(`Renamed project ${projectPath} to ${newPath}`);
        await this.parseSolutionFile();
        await this.initializeProjects();
        return newPath;
    }

    /**
     * Removes a project from the solution file
     */
    async removeProject(projectPath: string): Promise<void> {
        log.debug(`Removing project from solution: ${projectPath}`);

        try {
            // Use the dotnet CLI command to remove the project; no shell, so `$(...)` in the path is just text
            const solutionDir = path.dirname(this._solutionPath);
            const args = ['sln', this._solutionPath, 'remove', path.relative(solutionDir, projectPath)];
            log.debug(`Executing: dotnet ${args.join(' ')}`);

            const { execFile } = require('child_process');
            const { promisify } = require('util');
            await promisify(execFile)('dotnet', args, { cwd: solutionDir, timeout: 60000 });

            log.debug(`Successfully removed project from solution: ${projectPath}`);

            // Re-parse the solution file and re-initialize projects
            await this.parseSolutionFile();
            await this.initializeProjects();

        } catch (error) {
            log.error(`Error removing project from solution:`, error);
            throw error;
        }
    }

    /**
     * Forces a refresh of the solution (re-parse and re-initialize projects)
     */
    // Solution folders and items: the edits are in SolutionFolderEditor
    addSolutionFolder(...args: Parameters<SolutionFolderEditor['addSolutionFolder']>): ReturnType<SolutionFolderEditor['addSolutionFolder']> {
        return this._folders.addSolutionFolder(...args);
    }

    findSolutionFolderGuid(...args: Parameters<SolutionFolderEditor['findSolutionFolderGuid']>): ReturnType<SolutionFolderEditor['findSolutionFolderGuid']> {
        return this._folders.findSolutionFolderGuid(...args);
    }

    removeSolutionFolder(...args: Parameters<SolutionFolderEditor['removeSolutionFolder']>): ReturnType<SolutionFolderEditor['removeSolutionFolder']> {
        return this._folders.removeSolutionFolder(...args);
    }

    renameSolutionFolder(...args: Parameters<SolutionFolderEditor['renameSolutionFolder']>): ReturnType<SolutionFolderEditor['renameSolutionFolder']> {
        return this._folders.renameSolutionFolder(...args);
    }

    addSolutionItem(...args: Parameters<SolutionFolderEditor['addSolutionItem']>): ReturnType<SolutionFolderEditor['addSolutionItem']> {
        return this._folders.addSolutionItem(...args);
    }

    removeSolutionItem(...args: Parameters<SolutionFolderEditor['removeSolutionItem']>): ReturnType<SolutionFolderEditor['removeSolutionItem']> {
        return this._folders.removeSolutionItem(...args);
    }

    moveToSolutionFolder(...args: Parameters<SolutionFolderEditor['moveToSolutionFolder']>): ReturnType<SolutionFolderEditor['moveToSolutionFolder']> {
        return this._folders.moveToSolutionFolder(...args);
    }

    getSolutionFolderPath(...args: Parameters<SolutionFolderEditor['getSolutionFolderPath']>): ReturnType<SolutionFolderEditor['getSolutionFolderPath']> {
        return this._folders.getSolutionFolderPath(...args);
    }

    async refresh(): Promise<void> {
        log.debug('Forcing refresh...');
        await this.parseSolutionFile();
        await this.initializeProjects();
    }

    dispose(): void {
        log.debug(`Disposing solution: ${path.basename(this._solutionPath)}`);

        // Dispose debounce manager
        this._launchJsonDebouncer.dispose();

        // Dispose all projects
        for (const project of this._projects.values()) {
            project.dispose();
        }
        this._projects.clear();

        // Dispose event emitter
        this._changeEmitter.dispose();
        this._parseEmitter.dispose();

        // Dispose file watcher and other disposables
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];

        this._isInitialized = false;
    }

    /**
     * Sets the startup project for the solution
     */
    async setStartupProject(projectPath: string): Promise<void> {
        try {
            // Normalize the path for comparison (handle both absolute and relative paths)
            const solutionDir = path.dirname(this._solutionPath);
            const normalizedProjectPath = path.isAbsolute(projectPath)
                ? path.relative(solutionDir, projectPath)
                : projectPath;

            // Find the project by normalized path
            const project = this._solutionFile?.projects.find(p => {
                // Normalize solution file path for comparison (handle different path separators)
                const normalizedSolutionPath = p.path.replace(/\\/g, '/');
                const normalizedInputPath = normalizedProjectPath.replace(/\\/g, '/');
                return normalizedSolutionPath === normalizedInputPath;
            });

            if (!project) {
                log.error(`Project not found. Looking for: ${normalizedProjectPath}`);
                log.error(`Available projects:`, this._solutionFile?.projects.map(p => p.path));
                throw new Error(`Project not found: ${projectPath}`);
            }

            // Update launch.json with the new startup project (this is now the source of truth)
            log.debug(`About to update launch.json with startup project: ${projectPath}`);
            if (await DebugConfigService.updateStartupConfiguration(projectPath, undefined, true)) {
                // Like Visual Studio, a single startup project replaces a multi-project startup profile
                await StartupChoice.chooseSingle(this.solutionPath);
            }
            log.debug(`Finished updating launch.json`);

            // Note: No need to emit change event here - the launch.json file watcher will handle UI updates

            log.debug(`Set startup project: ${projectPath} (${project.guid})`);
        } catch (error) {
            log.error('Error setting startup project:', error);
            throw error;
        }
    }

    /**
     * Gets the current startup project from cache, refreshing if needed
     */
    getStartupProject(): string | null {
        log.debug(`getStartupProject() called, cached value: ${this._cachedStartupProject}`);

        // Check if we need to refresh the cache synchronously
        const freshStartupProject = DebugConfigService.getStartupProject();
        if (freshStartupProject !== this._cachedStartupProject) {
            log.debug(`Cache is stale (${this._cachedStartupProject} vs ${freshStartupProject}), updating...`);
            this._cachedStartupProject = freshStartupProject;
        }

        log.debug(`getStartupProject() returning: ${this._cachedStartupProject}`);
        return this._cachedStartupProject;
    }

    /**
     * Gets the current active framework from cache
     */
    getActiveFramework(): string | null {
        return this._cachedFramework;
    }

    /**
     * Forces a refresh of all project file trees
     */
    async forceRefreshAllProjects(): Promise<void> {
        log.debug('Forcing refresh of all project file trees');

        const refreshPromises: Promise<void>[] = [];
        for (const project of this._projects.values()) {
            refreshPromises.push(project.refresh());
        }

        await Promise.all(refreshPromises);
        log.debug('All project file trees refreshed');
    }
}