import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SolutionFileParser, SolutionFile, SolutionProject } from '../parsers/solutionFileParser';
import { Project } from './Project';

export interface SolutionChangeEvent {
    type: 'projectAdded' | 'projectRemoved' | 'solutionFolderAdded' | 'solutionFolderRemoved' | 'solutionFileChanged';
    project?: SolutionProject;
    solutionFolder?: SolutionProject;
}

export interface SolutionFileTreeNode {
    name: string;
    type: 'solutionFolder' | 'file';
    files?: SolutionFileItem[];
}

export interface SolutionFileItem {
    name: string;
    path: string;
    relativePath: string;
}

export class Solution {
    private _disposables: vscode.Disposable[] = [];
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _solutionFile?: SolutionFile;
    private _projects: Map<string, Project> = new Map();
    private _changeEmitter = new vscode.EventEmitter<SolutionChangeEvent>();
    private _fileTree: Record<string, SolutionFileTreeNode> = {}; // Solution files tree structure
    private _isInitialized = false;

    public readonly onDidChange = this._changeEmitter.event;

    constructor(private readonly _solutionPath: string) {
        this.initialize();
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

            // Parse the solution file initially
            await this.parseSolutionFile();

            // Initialize projects
            await this.initializeProjects();

            this._isInitialized = true;
            console.log(`[Solution] Initialized solution: ${path.basename(this._solutionPath)}`);
        } catch (error) {
            console.error('[Solution] Failed to initialize solution:', error);
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

    private async handleSolutionFileChanged(): Promise<void> {
        console.log('[Solution] Solution file changed, reparsing...');

        try {
            const oldSolutionFile = this._solutionFile;
            await this.parseSolutionFile();

            if (oldSolutionFile && this._solutionFile) {
                await this.detectAndNotifyChanges(oldSolutionFile, this._solutionFile);
            }

            this._changeEmitter.fire({ type: 'solutionFileChanged' });
        } catch (error) {
            console.error('[Solution] Error handling solution file change:', error);
        }
    }

    private handleSolutionFileDeleted(): void {
        console.log('[Solution] Solution file deleted');
        this.dispose();
    }

    private async parseSolutionFile(): Promise<void> {
        try {
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            this._solutionFile = await SolutionFileParser.parse(solutionContent, path.dirname(this._solutionPath));

            // Build file tree for solution folders and solution items
            this.buildSolutionFileTree();

            console.log(`[Solution] Parsed solution with ${this._solutionFile.projects.length} projects`);
        } catch (error) {
            console.error('[Solution] Error parsing solution file:', error);
            throw error;
        }
    }

    private buildSolutionFileTree(): void {
        if (!this._solutionFile) return;

        this._fileTree = {};
        const hierarchy = SolutionFileParser.buildProjectHierarchy(this._solutionFile);

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
                    const project = new Project(absolutePath, solutionProject);

                    // Subscribe to project changes
                    project.onDidChange((changeEvent) => {
                        // Forward project changes as needed
                        console.log(`[Solution] Project ${project.name} changed:`, changeEvent);
                    });

                    this._projects.set(absolutePath, project);

                    // Wait for project initialization
                    const projectInitPromise = this.waitForProjectInitialization(project, solutionProject.name);
                    projectPromises.push(projectInitPromise);
                } catch (error) {
                    console.error(`[Solution] Failed to initialize project ${solutionProject.name}:`, error);
                }
            }
        }

        // Wait for all projects to initialize
        await Promise.all(projectPromises);
        console.log(`[Solution] All ${projectPromises.length} projects initialized`);
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
            console.log(`[Solution] Project ${projectName} initialized successfully`);
        } else {
            console.warn(`[Solution] Project ${projectName} initialization timed out`);
        }
    }

    private async detectAndNotifyChanges(oldSolution: SolutionFile, newSolution: SolutionFile): Promise<void> {
        const oldProjects = new Map(oldSolution.projects.map(p => [p.path, p]));
        const newProjects = new Map(newSolution.projects.map(p => [p.path, p]));

        // Detect added projects
        for (const [projectPath, project] of newProjects) {
            if (!oldProjects.has(projectPath)) {
                if (SolutionFileParser.isDotNetProject(project)) {
                    console.log(`[Solution] Project added: ${project.name}`);

                    // Initialize new project
                    const absolutePath = path.resolve(path.dirname(this._solutionPath), project.path);
                    try {
                        const newProject = new Project(absolutePath, project);
                        this._projects.set(absolutePath, newProject);

                        this._changeEmitter.fire({ type: 'projectAdded', project });
                    } catch (error) {
                        console.error(`[Solution] Failed to initialize new project ${project.name}:`, error);
                    }
                } else if (SolutionFileParser.isSolutionFolder(project)) {
                    console.log(`[Solution] Solution folder added: ${project.name}`);
                    this._changeEmitter.fire({ type: 'solutionFolderAdded', solutionFolder: project });
                }
            }
        }

        // Detect removed projects
        for (const [projectPath, project] of oldProjects) {
            if (!newProjects.has(projectPath)) {
                if (SolutionFileParser.isDotNetProject(project)) {
                    console.log(`[Solution] Project removed: ${project.name}`);

                    // Dispose removed project
                    const absolutePath = path.resolve(path.dirname(this._solutionPath), project.path);
                    const removedProject = this._projects.get(absolutePath);
                    if (removedProject) {
                        removedProject.dispose();
                        this._projects.delete(absolutePath);
                    }

                    this._changeEmitter.fire({ type: 'projectRemoved', project });
                } else if (SolutionFileParser.isSolutionFolder(project)) {
                    console.log(`[Solution] Solution folder removed: ${project.name}`);
                    this._changeEmitter.fire({ type: 'solutionFolderRemoved', solutionFolder: project });
                }
            }
        }

        // Rebuild file tree for solution folders
        this.buildSolutionFileTree();
    }

    /**
     * Gets a project by its file path
     */
    getProject(projectPath: string): Project | undefined {
        console.log(`[Solution] getProject called with: ${projectPath}`);
        console.log(`[Solution] Available project paths:`, Array.from(this._projects.keys()));

        const project = this._projects.get(projectPath);
        if (!project) {
            // Try to find by matching project file name instead of full path
            for (const [storedPath, proj] of this._projects) {
                if (storedPath === projectPath || proj.projectPath === projectPath) {
                    console.log(`[Solution] Found project by alternate matching: ${proj.name}`);
                    return proj;
                }
            }
            console.log(`[Solution] No project found for path: ${projectPath}`);
        } else {
            console.log(`[Solution] Found project: ${project.name}`);
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

    /**
     * Adds a solution folder to the solution file
     */
    async addSolutionFolder(folderName: string): Promise<void> {
        console.log(`[Solution] Adding solution folder: ${folderName}`);

        const { v4: uuidv4 } = require('uuid');

        try {
            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

            // Generate a new GUID for the solution folder
            const folderGuid = `{${uuidv4().toUpperCase()}}`;
            const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';

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
            const newLines = [
                ...lines.slice(0, insertIndex),
                folderEntry,
                folderEndEntry,
                ...lines.slice(insertIndex)
            ];

            // Write the updated solution file
            const updatedContent = newLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

            console.log(`[Solution] Successfully added solution folder "${folderName}" to solution`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

        } catch (error) {
            console.error(`[Solution] Error adding solution folder to solution:`, error);
            throw error;
        }
    }

    /**
     * Adds a project to the solution file
     */
    async addProject(projectPath: string): Promise<void> {
        console.log(`[Solution] Adding project to solution: ${projectPath}`);

        try {
            // Use the dotnet CLI command to add the project
            const relativePath = path.relative(path.dirname(this._solutionPath), projectPath);
            const command = `dotnet sln "${this._solutionPath}" add "${relativePath}"`;

            console.log(`[Solution] Executing: ${command}`);

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            const solutionDir = path.dirname(this._solutionPath);

            await execAsync(command, { cwd: solutionDir });

            console.log(`[Solution] Successfully added project to solution: ${projectPath}`);

            // Re-parse the solution file and re-initialize projects
            await this.parseSolutionFile();
            await this.initializeProjects();

        } catch (error) {
            console.error(`[Solution] Error adding project to solution:`, error);
            throw error;
        }
    }

    /**
     * Forces a refresh of the solution (re-parse and re-initialize projects)
     */
    async refresh(): Promise<void> {
        console.log('[Solution] Forcing refresh...');
        await this.parseSolutionFile();
        await this.initializeProjects();
    }

    dispose(): void {
        console.log(`[Solution] Disposing solution: ${path.basename(this._solutionPath)}`);

        // Dispose all projects
        for (const project of this._projects.values()) {
            project.dispose();
        }
        this._projects.clear();

        // Dispose event emitter
        this._changeEmitter.dispose();

        // Dispose file watcher and other disposables
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];

        this._isInitialized = false;
    }
}