import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { SolutionXFileEditor } from '../parsers/solutionXFileEditor';
import { renameProjectInSln, renameProjectInSlnx, retargetProjectReferences } from '../parsers/projectRename';
import { SolutionFile, SolutionProject, PROJECT_TYPE_GUIDS } from '../types/solution';
import { ISolutionFileHandler, createSolutionFileHandler } from '../handlers';
import { DebugConfigService } from '../services/debugConfigService';
import { StartupChoice } from '../services/startupProfiles/startupChoice';
import { configurationProjectsOf, readConfigurationModel } from '../services/configurationManager/configurationManager';
import { ConfigurationModel } from '../services/configurationManager/model';
import { Project } from './Project';
import { logger } from './logger';
import { SimpleDebounceManager } from '../services/debounceManager';
import { SolutionFolderNodeId } from '../services/nodeIdService';
import { workspaceFolderOf } from '../services/workspaceFolders';
import { UnloadedProjects } from '../services/unloadedProjects';
import { pathKey } from '../services/projectItems/projectItems';

export interface SolutionFileTreeNode {
    name: string;
    type: 'solutionFolder' | 'file';
    files?: SolutionFileItem[];
}

/** A node of the solution file that drag & drop moves to another solution folder */
export type SolutionNodeMove =
    | { readonly kind: 'project'; readonly projectPath: string }
    | { readonly kind: 'solutionFolder'; readonly folderGuid: string }
    | { readonly kind: 'solutionItem'; readonly filePath: string; readonly folderGuid: string };

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

    constructor(private readonly _solutionPath: string) {
        // Create the appropriate file handler based on file extension
        this._handler = createSolutionFileHandler(_solutionPath);
        // Initialize debouncer for launch.json changes
        this._launchJsonDebouncer = new SimpleDebounceManager(async () => {
            log.info('launch.json changed, refreshing startup project and framework cache...');

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
        log.info('launch.json change detected, debouncing...');
        this._launchJsonDebouncer.trigger();
    }

    private handleLaunchJsonDeleted(): void {
        log.info('launch.json deleted, clearing cache');
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

            log.info(`Refreshed launch.json cache - startup project: ${startupProject}, framework: ${framework}`);
            log.debug(`Cached startup project is now: ${this._cachedStartupProject}`);
        } catch (error) {
            log.error('Error refreshing launch.json cache:', error);
            this._cachedStartupProject = null;
            this._cachedFramework = null;
        }
    }

    private async handleSolutionFileChanged(): Promise<void> {
        log.info('Solution file changed, reparsing...');

        try {
            await this.parseSolutionFile();

            // Notify UI that solution has changed
            this._changeEmitter.fire();

        } catch (error) {
            log.error('Error handling solution file change:', error);
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(`Could not reload ${path.basename(this._solutionPath)}: ${reason}`);
        }
    }

    private handleSolutionFileDeleted(): void {
        log.info('Solution file deleted');
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

    private async initializeProjects(): Promise<void> {
        if (!this._solutionFile) return;

        // Clear existing projects
        for (const project of this._projects.values()) {
            project.dispose();
        }
        this._projects.clear();

        // Initialize new projects and wait for them to be ready
        const projectPromises: Promise<void>[] = [];

        for (const solutionProject of this._solutionFile.projects) {
            if (SolutionFileParser.isDotNetProject(solutionProject)) {
                const absolutePath = path.resolve(path.dirname(this._solutionPath), solutionProject.path);

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
        log.info(`All ${projectPromises.length} projects initialized`);
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
     * Gets project by GUID
     */
    getProjectByGuid(guid: string): Project | undefined {
        for (const project of this._projects.values()) {
            if (project.solutionProject.guid === guid) {
                return project;
            }
        }
        return undefined;
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
     * Gets the project hierarchy as built by the parser
     */
    getProjectHierarchy(): Map<string, SolutionProject[]> {
        if (!this._solutionFile) return new Map();
        return SolutionFileParser.buildProjectHierarchy(this._solutionFile);
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
     * Returns the path segments of a solution folder (e.g. ['src', 'libs']) by walking up the nesting
     */
    private getSolutionFolderSegments(folderGuid: string): string[] {
        const segments: string[] = [];
        let guid: string | undefined = folderGuid;

        while (guid) {
            const folder = this._solutionFile?.projects.find(p => p.guid === guid && SolutionFileParser.isSolutionFolder(p));
            if (!folder) {
                throw new Error(`Solution folder "${guid}" not found`);
            }
            segments.unshift(folder.name);
            guid = this._solutionFile?.nestedProjects.find(n => n.childGuid === guid)?.parentGuid;
        }

        return segments;
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
        const content = await this._handler.read();
        await this._handler.write(edit(content, this.isSlnx ? 'slnx' : 'sln'));
        await this.parseSolutionFile();
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

    /**
     * Adds a solution folder to the solution file
     */
    async addSolutionFolder(folderName: string, parentNode?: SolutionFolderNodeId): Promise<void> {
        log.info(`Adding solution folder: ${folderName}${parentNode?.name ? ` under ${parentNode.name}` : ''}`);

        try {
            if (!folderName.trim() || /["\/\\]/.test(folderName)) {
                throw new Error(`Invalid solution folder name "${folderName}"`);
            }

            if (this.isSlnx) {
                const parentSegments = parentNode ? this.getSolutionFolderSegments(parentNode.guid) : [];
                await this.editSlnx(content => SolutionXFileEditor.addFolder(content, [...parentSegments, folderName]));
                log.info(`Successfully added solution folder "${folderName}" to solution`);
                return;
            }

            // Read the current solution file
            const solutionContent = await this._handler.read();
            const lines = solutionContent.split(/\r?\n/);

            // Generate a new GUID for the solution folder
            const folderGuid = `{${crypto.randomUUID().toUpperCase()}}`;
            const solutionFolderTypeGuid = PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;

            // Create the solution folder entry
            const folderEntry = `Project("${solutionFolderTypeGuid}") = "${folderName}", "${folderName}", "${folderGuid}"`;
            const folderEndEntry = 'EndProject';

            // Find the right place to insert the solution folder (after other projects but before GlobalSection)
            let insertIndex = -1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line === 'Global' || line.startsWith('Global')) {
                    insertIndex = i;
                    break;
                }
            }

            // If no Global section found, append at the end
            if (insertIndex === -1) {
                insertIndex = lines.length;
            }

            // Insert the solution folder
            let newLines = [
                ...lines.slice(0, insertIndex),
                folderEntry,
                folderEndEntry,
                ...lines.slice(insertIndex)
            ];

            // If this is a nested folder, we need to add/update the NestedProjects section
            if (parentNode) {
                // Find the parent folder's GUID
                if (!parentNode.guid) {
                    throw new Error(`Parent solution folder "${parentNode.name}" not found`);
                }

                // Add or update NestedProjects section
                newLines = this.addNestedProjectEntry(newLines, folderGuid, parentNode?.guid);
            }

            // Write the updated solution file
            const updatedContent = newLines.join(eolOf(solutionContent));
            await this._handler.write(updatedContent);

            log.info(`Successfully added solution folder "${folderName}" to solution`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

        } catch (error) {
            log.error(`Error adding solution folder to solution:`, error);
            throw error;
        }
    }

    /**
     * Finds the GUID of a solution folder by its name
     */
    public findSolutionFolderGuid(folderName: string): string | null {
        if (!this._solutionFile?.projects) {
            return null;
        }
        const folder = this._solutionFile.projects.find(
            p => p.name === folderName && SolutionFileParser.isSolutionFolder(p)
        );
        return folder ? folder.guid : null;
    }

    /**
     * Gets the name of a solution folder by its GUID
     */
    private getSolutionFolderName(folderGuid: string): string {
        const folder = this._solutionFile?.projects.find(
            p => p.guid === folderGuid && SolutionFileParser.isSolutionFolder(p)
        );
        if (!folder) {
            throw new Error(`Solution folder "${folderGuid}" not found`);
        }
        return folder.name;
    }

    /**
     * Adds a nested project entry to the NestedProjects section
     */
    private addNestedProjectEntry(lines: string[], childGuid: string, parentGuid: string): string[] {
        const nestedEntry = `\t\t${childGuid} = ${parentGuid}`;

        // Find existing NestedProjects section
        let nestedProjectsStartIndex = -1;
        let nestedProjectsEndIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'GlobalSection(NestedProjects) = preSolution') {
                nestedProjectsStartIndex = i;
            } else if (nestedProjectsStartIndex !== -1 && line === 'EndGlobalSection') {
                nestedProjectsEndIndex = i;
                break;
            }
        }

        if (nestedProjectsStartIndex !== -1) {
            // NestedProjects section exists, add our entry before EndGlobalSection
            return [
                ...lines.slice(0, nestedProjectsEndIndex),
                nestedEntry,
                ...lines.slice(nestedProjectsEndIndex)
            ];
        } else {
            // No NestedProjects section exists, create it before EndGlobal
            let endGlobalIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === 'EndGlobal') {
                    endGlobalIndex = i;
                    break;
                }
            }

            if (endGlobalIndex !== -1) {
                return [
                    ...lines.slice(0, endGlobalIndex),
                    '\tGlobalSection(NestedProjects) = preSolution',
                    nestedEntry,
                    '\tEndGlobalSection',
                    ...lines.slice(endGlobalIndex)
                ];
            } else {
                // No EndGlobal found, append at the end
                return [
                    ...lines,
                    'Global',
                    '\tGlobalSection(NestedProjects) = preSolution',
                    nestedEntry,
                    '\tEndGlobalSection',
                    'EndGlobal'
                ];
            }
        }
    }

    /**
     * Removes a solution folder from the solution file
     */
    async removeSolutionFolder(folderGuid: string): Promise<void> {
        log.info(`Removing solution folder: ${folderGuid}`);

        try {
            // Identify the folder by GUID: names are only unique among siblings
            const folderName = this.getSolutionFolderName(folderGuid);

            if (this.isSlnx) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.editSlnx(content => SolutionXFileEditor.removeFolder(content, segments));
                log.info(`Successfully removed solution folder "${folderName}" from solution`);
                return;
            }

            // Note: folder info captured but not currently used for event firing

            // Read the current solution file
            const solutionContent = await this._handler.read();
            const lines = solutionContent.split(/\r?\n/);

            // Find all child items (projects and folders) that need to be removed recursively
            const allItemsToRemove = this.findAllChildItemsRecursively(folderGuid);
            log.info(`Found ${allItemsToRemove.length} child items to remove recursively`);

            // Remove all child projects and folders recursively
            let newLines = lines;
            for (const itemGuid of allItemsToRemove) {
                const itemProject = this._solutionFile?.projects.find(p => p.guid === itemGuid);
                if (itemProject) {
                    if (SolutionFileParser.isSolutionFolder(itemProject)) {
                        // Remove child solution folder
                        newLines = this.removeSolutionFolderProject(newLines, itemProject.name, itemGuid);
                        log.info(`Removed child solution folder: ${itemProject.name}`);
                    } else if (SolutionFileParser.isDotNetProject(itemProject)) {
                        // Remove child project
                        newLines = this.removeProjectByGuid(newLines, itemGuid);
                        log.info(`Removed child project: ${itemProject.name}`);
                    }
                }
            }

            // Remove the solution folder Project/EndProject block
            newLines = this.removeSolutionFolderProject(newLines, folderName, folderGuid);

            // Remove all NestedProjects entries that reference this folder or any of its children
            newLines = this.removeNestedProjectEntries(newLines, folderGuid);
            for (const itemGuid of allItemsToRemove) {
                newLines = this.removeNestedProjectEntries(newLines, itemGuid);
            }

            // Write the updated solution file
            const updatedContent = newLines.join(eolOf(solutionContent));
            await this._handler.write(updatedContent);

            log.info(`Successfully removed solution folder "${folderName}" and ${allItemsToRemove.length} child items from solution`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error removing solution folder from solution:`, error);
            throw error;
        }
    }

    /**
     * Renames a solution folder in the solution file
     */
    async renameSolutionFolder(folderGuid: string, newName: string): Promise<void> {
        try {
            const oldName = this.getSolutionFolderName(folderGuid);
            log.info(`Renaming solution folder from "${oldName}" to "${newName}"`);

            if (!newName.trim() || /["\/\\]/.test(newName)) {
                throw new Error(`Invalid solution folder name "${newName}"`);
            }

            if (this.isSlnx) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.editSlnx(content => SolutionXFileEditor.renameFolder(content, segments, newName));
                log.info(`Successfully renamed solution folder from "${oldName}" to "${newName}"`);
                return;
            }

            // Read the current solution file
            const solutionContent = await this._handler.read();
            const lines = solutionContent.split(/\r?\n/);

            // Find and update the Project line for this solution folder
            const solutionFolderTypeGuid = PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;
            const updatedLines = lines.map(line => {
                const trimmedLine = line.trim();

                // Check if this is the Project line for our solution folder
                if (trimmedLine.includes(`Project("${solutionFolderTypeGuid}")`) &&
                    trimmedLine.includes(`"${oldName}"`) &&
                    trimmedLine.includes(folderGuid)) {
                    // Replace the old name with the new name in the Project line
                    // Format: Project("{guid}") = "OldName", "OldName", "{folder-guid}"
                    return line.split(`"${oldName}"`).join(`"${newName}"`);
                }

                return line;
            });

            // Write the updated solution file
            const updatedContent = updatedLines.join(eolOf(solutionContent));
            await this._handler.write(updatedContent);

            log.info(`Successfully renamed solution folder from "${oldName}" to "${newName}"`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error renaming solution folder:`, error);
            throw error;
        }
    }

    /**
     * Adds a solution item (file) to a solution folder
     */
    async addSolutionItem(folderGuid: string, filePath: string): Promise<void> {
        log.info(`Adding solution item "${filePath}" to folder "${folderGuid}"`);

        try {
            // Find the solution folder to get its GUID
            if (!folderGuid) {
                throw new Error(`Solution folder "${folderGuid}" not found`);
            }

            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this._solutionPath);
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            if (this.isSlnx) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.editSlnx(content => SolutionXFileEditor.addFile(content, segments, relativePath));
                log.info(`Successfully added solution item "${path.basename(filePath)}" to folder "${folderGuid}"`);
                return;
            }

            // Read the current solution file
            const solutionContent = await this._handler.read();
            const lines = solutionContent.split(/\r?\n/);

            // Find the solution folder's Project block and add the file to it
            const updatedLines = this.addSolutionItemToFolder(lines, folderGuid, relativePath);

            // Write the updated solution file
            const updatedContent = updatedLines.join(eolOf(solutionContent));
            await this._handler.write(updatedContent);

            log.info(`Successfully added solution item "${path.basename(filePath)}" to folder "${folderGuid}"`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error adding solution item:`, error);
            throw error;
        }
    }

    /**
     * Removes a solution item (file) from a solution folder
     */
    async removeSolutionItem(filePath: string): Promise<void> {
        log.info(`Removing solution item from solution: ${filePath}`);

        try {
            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this._solutionPath);
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            if (this.isSlnx) {
                await this.editSlnx(content => SolutionXFileEditor.removeFile(content, relativePath));
                log.info(`Successfully removed solution item "${path.basename(filePath)}" from solution`);
                return;
            }

            // Read the current solution file
            const solutionContent = await this._handler.read();
            const lines = solutionContent.split(/\r?\n/);

            // Remove the file reference from the solution file
            const updatedLines = this.removeSolutionItemFromFile(lines, relativePath);

            // Write the updated solution file
            const updatedContent = updatedLines.join(eolOf(solutionContent));
            await this._handler.write(updatedContent);

            log.info(`Successfully removed solution item "${path.basename(filePath)}" from solution`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error removing solution item:`, error);
            throw error;
        }
    }

    /**
     * Moves a project, solution folder or solution item into another solution folder (`undefined`: the solution root,
     * not for solution items), like Visual Studio's drag & drop. Refuses a folder into itself or a folder inside it and
     * a name the target already has; a node already there is left alone.
     */
    async moveToSolutionFolder(node: SolutionNodeMove, targetFolderGuid: string | undefined): Promise<void> {
        const solutionFile = this._solutionFile;
        if (!solutionFile) {
            throw new Error('The solution is not loaded');
        }
        const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
        const parentOf = (guid: string) => solutionFile.nestedProjects.find(n => same(n.childGuid, guid))?.parentGuid;
        const folderOf = (guid: string) => solutionFile.projects.find(p => same(p.guid, guid) && SolutionFileParser.isSolutionFolder(p));
        const target = targetFolderGuid === undefined ? undefined : folderOf(targetFolderGuid);
        if (targetFolderGuid !== undefined && !target) {
            throw new Error(`Solution folder "${targetFolderGuid}" not found`);
        }
        const targetName = target ? `"${target.name}"` : 'The solution';
        const solutionDir = path.dirname(this._solutionPath);
        const relative = (file: string) => path.relative(solutionDir, file).split(path.sep).join('/');

        if (node.kind === 'solutionItem') {
            const from = folderOf(node.folderGuid);
            if (!target) {
                throw new Error('Solution items belong in a solution folder');
            }
            if (!from) {
                throw new Error(`Solution folder "${node.folderGuid}" not found`);
            }
            if (same(from.guid, target.guid)) {
                return;
            }
            const itemPath = relative(node.filePath);
            const key = (item: string) => item.replace(/\\/g, '/').toLowerCase();
            if (this.getSolutionItems(target).some(item => key(item) === key(itemPath))) {
                throw new Error(`${targetName} already contains ${path.basename(node.filePath)}`);
            }
            if (this.isSlnx) {
                await this.editSlnx(content => SolutionXFileEditor.moveFile(
                    content, this.getSolutionFolderSegments(from.guid), itemPath, this.getSolutionFolderSegments(target.guid)));
            } else {
                await this.editSlnLines(lines => this.moveSolutionItemLines(lines, from.guid, target.guid, itemPath));
            }
            log.info(`Moved solution item ${itemPath} to ${targetName}`);
            return;
        }

        const moving = node.kind === 'project'
            ? solutionFile.projects.find(p => !SolutionFileParser.isSolutionFolder(p)
                && path.resolve(solutionDir, p.path) === path.resolve(node.projectPath))
            : folderOf(node.folderGuid);
        if (!moving) {
            throw new Error(`${node.kind === 'project' ? path.basename(node.projectPath) : 'The solution folder'} is not in the solution`);
        }
        const currentParent = parentOf(moving.guid);
        if (target ? same(currentParent, target.guid) : !currentParent) {
            return;
        }
        for (let guid = target?.guid, depth = 0; guid && depth < 64; guid = parentOf(guid), depth++) {
            if (same(guid, moving.guid)) {
                throw new Error(`"${moving.name}" cannot be moved into itself or a folder inside it`);
            }
        }
        const siblings = solutionFile.projects.filter(p => target ? same(parentOf(p.guid), target.guid) : !parentOf(p.guid));
        if (siblings.some(p => p.name.toLowerCase() === moving.name.toLowerCase())) {
            throw new Error(`${targetName} already contains "${moving.name}"`);
        }

        if (this.isSlnx) {
            const targetSegments = target ? this.getSolutionFolderSegments(target.guid) : [];
            await this.editSlnx(content => node.kind === 'project'
                ? SolutionXFileEditor.moveProject(content, relative(node.projectPath), targetSegments)
                : SolutionXFileEditor.moveFolder(content, this.getSolutionFolderSegments(moving.guid), targetSegments));
        } else {
            await this.editSlnLines(lines => this.setNestedParent(lines, moving.guid, target?.guid));
        }
        log.info(`Moved "${moving.name}" to ${targetName}`);
    }

    /** Reads the .sln, applies a line edit, writes it with the file's line endings and re-parses */
    private async editSlnLines(edit: (lines: string[]) => string[]): Promise<void> {
        const content = await this._handler.read();
        await this._handler.write(edit(content.split(/\r?\n/)).join(eolOf(content)));
        await this.parseSolutionFile();
    }

    /**
     * Points the child's `NestedProjects` entry at `parentGuid`, or removes it (the solution root); a section left
     * empty goes too, as Visual Studio writes none
     */
    private setNestedParent(lines: string[], childGuid: string, parentGuid: string | undefined): string[] {
        const start = lines.findIndex(line => line.trim() === 'GlobalSection(NestedProjects) = preSolution');
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndGlobalSection');
        const entry = end === -1 ? -1 : lines.findIndex((line, i) => i > start && i < end
            && line.split('=')[0].trim().toUpperCase() === childGuid.toUpperCase());
        if (entry === -1) {
            return parentGuid ? this.addNestedProjectEntry(lines, childGuid, parentGuid) : lines;
        }
        if (parentGuid) {
            return lines.map((line, i) => i === entry ? line.replace(/=\s*\{[^}]*\}\s*$/, `= ${parentGuid}`) : line);
        }
        const without = lines.filter((_, i) => i !== entry);
        // Only the section's first and last line are left
        return end - start === 2 ? without.filter((_, i) => i !== start && i !== start + 1) : without;
    }

    /** The `Project(...)` line and the `EndProject` line of a solution folder */
    private solutionFolderBlock(lines: string[], folderGuid: string): { start: number; end: number } {
        const start = lines.findIndex(line => line.trim().startsWith(`Project("${PROJECT_TYPE_GUIDS.SOLUTION_FOLDER}")`)
            && line.toUpperCase().includes(folderGuid.toUpperCase()));
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndProject');
        if (end === -1) {
            throw new Error(`Could not find the block of solution folder "${folderGuid}"`);
        }
        return { start, end };
    }

    /**
     * Moves a solution item's line from one solution folder's `ProjectSection(SolutionItems)` to another's, keeping its
     * text (Visual Studio writes `\`); a section left empty goes
     */
    private moveSolutionItemLines(lines: string[], fromGuid: string, toGuid: string, itemPath: string): string[] {
        const block = this.solutionFolderBlock(lines, fromGuid);
        const key = (text: string) => text.replace(/\\/g, '/').toLowerCase();
        const index = lines.findIndex((line, i) => i > block.start && i < block.end && line.includes('=')
            && key(line.split('=')[0].trim()) === key(itemPath));
        if (index === -1) {
            throw new Error(`Solution item "${itemPath}" not found in its solution folder`);
        }
        const item = lines[index].split('=')[0].trim();
        let without = lines.filter((_, i) => i !== index);
        if (without[index - 1]?.trim() === 'ProjectSection(SolutionItems) = preProject' && without[index]?.trim() === 'EndProjectSection') {
            without = without.filter((_, i) => i !== index - 1 && i !== index);
        }
        return this.addSolutionItemToFolder(without, toGuid, item);
    }

    /**
     * Removes a solution folder Project/EndProject block from the solution file lines
     */
    private removeSolutionFolderProject(lines: string[], folderName: string, folderGuid: string): string[] {
        const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line for this solution folder
            if (line.includes(`Project("${solutionFolderTypeGuid}")`) &&
                line.includes(`"${folderName}"`) &&
                line.includes(folderGuid)) {
                startIndex = i;
            }

            // Look for the corresponding EndProject line
            if (startIndex !== -1 && line === 'EndProject') {
                endIndex = i;
                break;
            }
        }

        if (startIndex !== -1 && endIndex !== -1) {
            // Remove the Project/EndProject block
            return [
                ...lines.slice(0, startIndex),
                ...lines.slice(endIndex + 1)
            ];
        }

        return lines;
    }

    /**
     * Finds all child items (projects and folders) recursively for a given parent folder GUID
     */
    private findAllChildItemsRecursively(parentGuid: string): string[] {
        if (!this._solutionFile) return [];

        const childGuids: string[] = [];
        const hierarchy = SolutionFileParser.buildProjectHierarchy(this._solutionFile);

        // Get direct children
        const directChildren = hierarchy.get(parentGuid) || [];

        for (const child of directChildren) {
            childGuids.push(child.guid);

            // If this child is a solution folder, recursively find its children
            if (SolutionFileParser.isSolutionFolder(child)) {
                const grandchildren = this.findAllChildItemsRecursively(child.guid);
                childGuids.push(...grandchildren);
            }
        }

        return childGuids;
    }

    /**
     * Removes a project by its GUID from the solution file lines
     */
    private removeProjectByGuid(lines: string[], projectGuid: string): string[] {
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line that contains this GUID
            if (line.startsWith('Project(') && line.includes(projectGuid)) {
                startIndex = i;
            }

            // Look for the corresponding EndProject line
            if (startIndex !== -1 && line === 'EndProject') {
                endIndex = i;
                break;
            }
        }

        if (startIndex !== -1 && endIndex !== -1) {
            // Remove the Project/EndProject block
            return [
                ...lines.slice(0, startIndex),
                ...lines.slice(endIndex + 1)
            ];
        }

        return lines;
    }

    /**
     * Removes all NestedProjects entries that reference the given folder GUID
     */
    private removeNestedProjectEntries(lines: string[], folderGuid: string): string[] {
        // Find NestedProjects section
        let nestedProjectsStartIndex = -1;
        let nestedProjectsEndIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'GlobalSection(NestedProjects) = preSolution') {
                nestedProjectsStartIndex = i;
            } else if (nestedProjectsStartIndex !== -1 && line === 'EndGlobalSection') {
                nestedProjectsEndIndex = i;
                break;
            }
        }

        if (nestedProjectsStartIndex === -1 || nestedProjectsEndIndex === -1) {
            // No NestedProjects section found
            return lines;
        }

        // Filter out entries that reference the folder GUID (as parent or child)
        const newLines = [...lines];
        const entriesToRemove: number[] = [];

        for (let i = nestedProjectsStartIndex + 1; i < nestedProjectsEndIndex; i++) {
            const line = lines[i];
            if (line.includes(folderGuid)) {
                entriesToRemove.push(i);
            }
        }

        // Remove entries in reverse order to maintain indices
        for (let i = entriesToRemove.length - 1; i >= 0; i--) {
            newLines.splice(entriesToRemove[i], 1);
        }

        return newLines;
    }

    /**
     * Adds a solution item to a solution folder's Project block
     */
    private addSolutionItemToFolder(lines: string[], folderGuid: string, relativePath: string): string[] {
        const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
        let projectStartIndex = -1;
        let projectEndIndex = -1;

        // Find the Project/EndProject block for this solution folder
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line for this solution folder
            if (line.includes(`Project("${solutionFolderTypeGuid}")`) &&
                line.includes(folderGuid)) {
                projectStartIndex = i;
            }

            // Look for the corresponding EndProject line
            if (projectStartIndex !== -1 && line === 'EndProject') {
                projectEndIndex = i;
                break;
            }
        }

        if (projectStartIndex === -1 || projectEndIndex === -1) {
            throw new Error(`Could not find Project block for solution folder "${folderGuid}"`);
        }

        // Check if there are already ProjectSection(SolutionItems) in this folder
        let solutionItemsStartIndex = -1;
        let solutionItemsEndIndex = -1;

        for (let i = projectStartIndex + 1; i < projectEndIndex; i++) {
            const line = lines[i].trim();
            if (line === 'ProjectSection(SolutionItems) = preProject') {
                solutionItemsStartIndex = i;
            } else if (solutionItemsStartIndex !== -1 && line === 'EndProjectSection') {
                solutionItemsEndIndex = i;
                break;
            }
        }

        const newLines = [...lines];

        if (solutionItemsStartIndex !== -1 && solutionItemsEndIndex !== -1) {
            // ProjectSection exists, add the item to it
            const itemLine = `\t\t${relativePath} = ${relativePath}`;
            newLines.splice(solutionItemsEndIndex, 0, itemLine);
        } else {
            // No ProjectSection exists, create one with the item
            const sectionLines = [
                '\tProjectSection(SolutionItems) = preProject',
                `\t\t${relativePath} = ${relativePath}`,
                '\tEndProjectSection'
            ];

            // Insert before EndProject
            newLines.splice(projectEndIndex, 0, ...sectionLines);
        }

        return newLines;
    }

    private removeSolutionItemFromFile(lines: string[], relativePath: string): string[] {
        const newLines = [...lines];
        let removedItemIndex = -1;

        // Find and remove the specific solution item line
        for (let i = 0; i < newLines.length; i++) {
            const line = newLines[i].trim();
            // Look for the item line in format: "\t\trelativePath = relativePath"
            if (line === `${relativePath} = ${relativePath}`) {
                removedItemIndex = i;
                newLines.splice(i, 1);
                break;
            }
        }

        if (removedItemIndex === -1) {
            log.warn(`Solution item "${relativePath}" not found in solution file`);
            return newLines;
        }

        // Check if the ProjectSection(SolutionItems) is now empty and remove it if so
        // Find the ProjectSection that contained this item
        let sectionStartIndex = -1;
        let sectionEndIndex = -1;

        // Search backwards from where the item was to find the section start
        for (let i = removedItemIndex - 1; i >= 0; i--) {
            const line = newLines[i].trim();
            if (line === 'ProjectSection(SolutionItems) = preProject') {
                sectionStartIndex = i;
                break;
            } else if (line === 'EndProject' || line.startsWith('Project(')) {
                // We've gone too far back
                break;
            }
        }

        // Search forwards from where the item was to find the section end
        if (sectionStartIndex !== -1) {
            for (let i = removedItemIndex; i < newLines.length; i++) {
                const line = newLines[i].trim();
                if (line === 'EndProjectSection') {
                    sectionEndIndex = i;
                    break;
                } else if (line === 'EndProject' || line.startsWith('Project(')) {
                    // We've gone too far forward
                    break;
                }
            }
        }

        // If we found the section boundaries, check if it's empty and remove it
        if (sectionStartIndex !== -1 && sectionEndIndex !== -1) {
            let hasItems = false;
            for (let i = sectionStartIndex + 1; i < sectionEndIndex; i++) {
                const line = newLines[i].trim();
                if (line.includes(' = ') && !line.startsWith('ProjectSection') && !line.startsWith('EndProjectSection')) {
                    hasItems = true;
                    break;
                }
            }

            // If no items remain in the section, remove the entire section
            if (!hasItems) {
                newLines.splice(sectionStartIndex, sectionEndIndex - sectionStartIndex + 1);
            }
        }

        return newLines;
    }

    /**
     * Path of a solution folder as `dotnet sln add --solution-folder` expects it, e.g. `Libs/Inner`
     */
    getSolutionFolderPath(folderGuid: string): string | undefined {
        const solutionFile = this._solutionFile;
        if (!solutionFile) {
            return undefined;
        }
        const same = (a: string | undefined, b: string) => a?.toUpperCase() === b.toUpperCase();
        const names: string[] = [];
        const seen = new Set<string>();
        let guid: string | undefined = folderGuid;
        while (guid && !seen.has(guid.toUpperCase())) {
            seen.add(guid.toUpperCase());
            const current: string = guid;
            const folder = solutionFile.projects.find(p => same(p.guid, current));
            if (!folder) {
                return undefined;
            }
            names.unshift(folder.name);
            guid = solutionFile.nestedProjects.find(n => same(n.childGuid, current))?.parentGuid;
        }
        return names.join('/');
    }

    /**
     * Adds a project to the solution file, at the root or into a solution folder (`Libs/Inner`).
     * Like Visual Studio, a project added at the root stays there; `dotnet sln add` alone would
     * create solution folders mirroring the project's directories.
     */
    async addProject(projectPath: string, solutionFolderPath?: string): Promise<void> {
        log.info(`Adding project to solution: ${projectPath}${solutionFolderPath ? ` (folder ${solutionFolderPath})` : ''}`);

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

            log.info(`Successfully added project to solution: ${projectPath}`);

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
        const content = await this._handler.read();
        await this._handler.write(this.isSlnx
            ? renameProjectInSlnx(content, relative(projectPath), relative(newPath))
            : renameProjectInSln(content, relative(projectPath), relative(newPath), name));

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

        log.info(`Renamed project ${projectPath} to ${newPath}`);
        await this.parseSolutionFile();
        await this.initializeProjects();
        return newPath;
    }

    /**
     * Removes a project from the solution file
     */
    async removeProject(projectPath: string): Promise<void> {
        log.info(`Removing project from solution: ${projectPath}`);

        try {
            // Use the dotnet CLI command to remove the project; no shell, so `$(...)` in the path is just text
            const solutionDir = path.dirname(this._solutionPath);
            const args = ['sln', this._solutionPath, 'remove', path.relative(solutionDir, projectPath)];
            log.debug(`Executing: dotnet ${args.join(' ')}`);

            const { execFile } = require('child_process');
            const { promisify } = require('util');
            await promisify(execFile)('dotnet', args, { cwd: solutionDir, timeout: 60000 });

            log.info(`Successfully removed project from solution: ${projectPath}`);

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
    async refresh(): Promise<void> {
        log.info('Forcing refresh...');
        await this.parseSolutionFile();
        await this.initializeProjects();
    }

    dispose(): void {
        log.info(`Disposing solution: ${path.basename(this._solutionPath)}`);

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
            log.info(`About to update launch.json with startup project: ${projectPath}`);
            if (await DebugConfigService.updateStartupConfiguration(projectPath, undefined, true)) {
                // Like Visual Studio, a single startup project replaces a multi-project startup profile
                await StartupChoice.useSingle(this.solutionPath);
            }
            log.info(`Finished updating launch.json`);

            // Note: No need to emit change event here - the launch.json file watcher will handle UI updates

            log.info(`Set startup project: ${projectPath} (${project.guid})`);
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
        log.info('Forcing refresh of all project file trees');

        const refreshPromises: Promise<void>[] = [];
        for (const project of this._projects.values()) {
            refreshPromises.push(project.refresh());
        }

        await Promise.all(refreshPromises);
        log.info('All project file trees refreshed');
    }
}