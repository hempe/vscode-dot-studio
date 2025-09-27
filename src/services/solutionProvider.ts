import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SolutionManager } from './solutionManager';
import { ProjectFileParser } from '../parsers/projectFileParser';
import { SolutionItem } from '../types/solutionItem';
import { FileNestingService, NestedFile } from './fileNesting';
import { shouldSkipDirectory } from '../core/constants';
import { SolutionFileParser, SolutionFile, SolutionProject } from '../parsers/solutionFileParser';
import { PathUtils, ErrorUtils } from '../core/utils';
import { SolutionUserFile } from '../parsers/solutionUserFile';
import { SolutionService } from './solutionService';
import { Solution } from '../core/Solution';
import { Project } from '../core/Project';
import { logger } from '../core/logger';


export class SolutionProvider implements vscode.TreeDataProvider<SolutionItem> {
    private readonly logger = logger('PackageUpdateService');

    private _onDidChangeTreeData: vscode.EventEmitter<SolutionItem | undefined | null | void> = new vscode.EventEmitter<SolutionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SolutionItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private solutionManager?: SolutionManager;
    private projectFileParser?: ProjectFileParser;
    private expandedItems = new Set<string>(); // Track expanded items by their resource path
    private copiedFile?: string; // Track copied file path for paste operations
    private isCutOperation = false; // Track if this is a cut (move) operation
    private frameworkFilter?: string; // Current framework filter

    constructor(private workspaceRoot?: string) {
        if (workspaceRoot) {
            this.solutionManager = new SolutionManager(workspaceRoot);
            this.projectFileParser = new ProjectFileParser(workspaceRoot);
        }
    }

    refresh(): void {
        // Clear solution parsing caches to ensure fresh solution structure
        this.parsedSolutions.clear();
        this.projectHierarchy.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Set the framework filter for the tree view
     */
    setFrameworkFilter(framework?: string): void {
        this.frameworkFilter = framework;
        this.refresh();
    }

    /**
     * Get the current framework filter
     */
    getFrameworkFilter(): string | undefined {
        return this.frameworkFilter;
    }

    /**
     * Initialize framework filter from .sln.user file
     */
    private async initializeFrameworkFilter(solutionPath: string): Promise<void> {
        if (this.frameworkFilter !== undefined) {
            return; // Already initialized
        }

        try {
            const solutionUserFile = new SolutionUserFile(solutionPath);
            const storedFramework = await solutionUserFile.getFrameworkFilter();
            this.frameworkFilter = storedFramework || undefined;
        } catch (error) {
            this.logger.error('Error loading framework filter from .sln.user file:', error);
            this.frameworkFilter = undefined;
        }
    }

    // Methods to track expansion state
    setExpanded(item: SolutionItem, expanded: boolean): void {
        if (!item.resourceUri) return;

        const key = item.resourceUri.fsPath;
        if (expanded) {
            this.expandedItems.add(key);
        } else {
            this.expandedItems.delete(key);
        }
    }

    public isExpanded(resourcePath: string): boolean {
        return this.expandedItems.has(resourcePath);
    }

    private getCollapsibleState(itemType: string, resourceUri?: vscode.Uri, defaultState?: vscode.TreeItemCollapsibleState): vscode.TreeItemCollapsibleState {
        if (!resourceUri) {
            return defaultState || vscode.TreeItemCollapsibleState.None;
        }

        // Check if we have a saved expansion state
        if (this.isExpanded(resourceUri.fsPath)) {
            return vscode.TreeItemCollapsibleState.Expanded;
        }

        // Default states
        if (itemType === 'solution') {
            return vscode.TreeItemCollapsibleState.Expanded; // Solutions start expanded
        } else if (itemType === 'project' || itemType === 'folder') {
            return vscode.TreeItemCollapsibleState.Collapsed; // Projects and folders start collapsed
        }

        return defaultState || vscode.TreeItemCollapsibleState.None;
    }

    getTreeItem(element: SolutionItem): vscode.TreeItem {
        this.logger.info(`getTreeItem called for: ${element.itemType} - ${element.label}, collapsibleState: ${element.collapsibleState}`);
        return element;
    }

    getParent(element: SolutionItem): SolutionItem | undefined {
        // This method is required for TreeView.reveal() to work
        // For now, return undefined as we don't track parent relationships
        // TODO: If we need reveal functionality to work properly, we'd need to track parent-child relationships
        this.logger.info('getParent called for element:', element.label);
        return undefined;
    }

    getChildren(element?: SolutionItem): Thenable<SolutionItem[]> {
        this.logger.info(`getChildren called with element:`, element ? `${element.itemType} - ${element.label}` : 'root');

        if (!this.workspaceRoot) {
            this.logger.info(`No workspace root, returning empty array`);
            return Promise.resolve([]);
        }

        if (!element) {
            this.logger.info(`Getting root solutions and projects`);
            return this.getSolutionAndProjects();
        }

        if (element.itemType === 'solution' && element.resourceUri) {
            this.logger.info(`Getting projects from solution: ${element.label}`);
            return this.getProjectsFromSolution(element.resourceUri);
        }

        if (element.itemType === 'project' && element.resourceUri) {
            this.logger.info(`Getting files from project: ${element.label} (${element.resourceUri.fsPath})`);
            return this.getFilesFromProject(element.resourceUri);
        }

        if (element.itemType === 'folder' && element.resourceUri && element.projectPath) {
            this.logger.info(`Getting files from folder: ${element.label} (${element.resourceUri.fsPath})`);
            return this.getFilesFromFolder(element.resourceUri, element.projectPath);
        }

        if (element.itemType === 'file' && (element as any).nestedChildren) {
            this.logger.info(`Getting nested children for file: ${element.label}`);
            // Handle nested files (e.g., expanding EditUser.cshtml to show EditUser.cshtml.cs)
            const nestedChildren = (element as any).nestedChildren as NestedFile[];
            return Promise.resolve(this.convertNestedFilesToSolutionItems(nestedChildren, element.projectPath || ''));
        }

        if (element.itemType === 'dependencies' && element.resourceUri) {
            this.logger.info(`Getting dependencies for project: ${element.projectPath}`);
            return this.getDependenciesFromProject(element.resourceUri);
        }

        if (element.itemType === 'solutionFolder') {
            this.logger.info(`Getting children from solution folder: ${element.label}`);
            return this.getChildrenFromSolutionFolder(element);
        }

        this.logger.info(`Unknown element type or missing data, returning empty array`);
        return Promise.resolve([]);
    }

    private async getSolutionAndProjects(): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');

        for (const solutionFile of solutionFiles) {
            const solutionName = path.basename(solutionFile.fsPath, '.sln');
            items.push(new SolutionItem(
                solutionName,
                this.getCollapsibleState('solution', solutionFile),
                solutionFile,
                'solution'
            ));
        }

        // Only search for standalone projects if no solutions exist
        if (solutionFiles.length === 0) {
            const projectFiles = await vscode.workspace.findFiles('*.{csproj,vbproj,fsproj}', '**/node_modules/**');
            for (const projectFile of projectFiles) {
                const projectName = PathUtils.getProjectName(projectFile.fsPath);
                items.push(new SolutionItem(
                    projectName,
                    this.getCollapsibleState('project', projectFile),
                    projectFile,
                    'project'
                ));
            }
        }

        return items;
    }

    private async getProjectsFromSolution(solutionUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        if (!this.solutionManager) {
            return items;
        }

        // Try to use the active solution from SolutionService first
        const activeSolution = SolutionService.getActiveSolution();
        if (activeSolution && activeSolution.solutionPath === solutionUri.fsPath) {
            return this.getProjectsFromSolutionInstance(activeSolution);
        }

        // Fallback to manual parsing if no active solution
        return this.getProjectsFromSolutionFallback(solutionUri);
    }

    private parsedSolutions = new Map<string, SolutionFile>(); // Cache for parsed solutions
    private projectHierarchy = new Map<string, SolutionProject[]>(); // Cache for project hierarchy

    /**
     * Gets projects and solution folders from a Solution instance
     */
    private async getProjectsFromSolutionInstance(solution: Solution): Promise<SolutionItem[]> {
        if (!solution.solutionFile) {
            return [];
        }

        try {
            // Initialize framework filter from .sln.user file
            await this.initializeFrameworkFilter(solution.solutionPath);

            // Cache the solution file data for compatibility with existing methods
            this.parsedSolutions.set(solution.solutionPath, solution.solutionFile);
            this.projectHierarchy = solution.getProjectHierarchy();

            // Get root level projects and solution folders
            const rootProjects = this.projectHierarchy.get('ROOT') || [];
            return await this.convertProjectsToSolutionItems(rootProjects, solution.solutionPath);
        } catch (error) {
            ErrorUtils.showError('Error getting projects from solution instance', error);
            return [];
        }
    }

    private async getProjectsFromSolutionFallback(solutionUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        try {
            const solutionContent = await fs.promises.readFile(solutionUri.fsPath, 'utf8');
            const solutionFile = await SolutionFileParser.parse(solutionContent, path.dirname(solutionUri.fsPath));

            // Initialize framework filter from .sln.user file
            await this.initializeFrameworkFilter(solutionUri.fsPath);

            // Cache the parsed solution
            this.parsedSolutions.set(solutionUri.fsPath, solutionFile);
            this.projectHierarchy = SolutionFileParser.buildProjectHierarchy(solutionFile);

            // Get root level projects and solution folders
            const rootProjects = this.projectHierarchy.get('ROOT') || [];
            return await this.convertProjectsToSolutionItems(rootProjects, solutionUri.fsPath);
        } catch (error) {
            ErrorUtils.showError('Error parsing solution file', error);
        }

        return items;
    }

    private async convertProjectsToSolutionItems(projects: SolutionProject[], solutionPath: string): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];
        const solutionFolders: SolutionItem[] = [];
        const regularProjects: SolutionItem[] = [];

        // Separate solution folders and projects
        for (const project of projects) {
            if (SolutionFileParser.isSolutionFolder(project)) {
                // Check if solution folder has content (children or solution items)
                const children = this.projectHierarchy.get(project.guid) || [];
                const solutionItems = SolutionFileParser.getSolutionItems(project);
                const hasContent = children.length > 0 || solutionItems.length > 0;
                const collapsibleState = hasContent ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

                const item = new SolutionItem(
                    project.name,
                    this.getCollapsibleState('solutionFolder', undefined, collapsibleState),
                    undefined, // Solution folders don't have file URIs
                    'solutionFolder',
                    undefined,
                    undefined,
                    solutionPath
                );
                // Store the project GUID so we can find children later
                (item as any).projectGuid = project.guid;
                // Also set id property for commands to use
                (item as any).id = project.guid;
                solutionFolders.push(item);
            } else if (SolutionFileParser.isDotNetProject(project)) {
                // Apply framework filtering if active
                if (this.frameworkFilter && project.targetFrameworks) {
                    const hasTargetFramework = project.targetFrameworks.includes(this.frameworkFilter);
                    if (!hasTargetFramework) {
                        continue; // Skip this project if it doesn't target the selected framework
                    }
                }

                // Resolve project path relative to solution directory
                const solutionDir = path.dirname(solutionPath);
                const absoluteProjectPath = path.resolve(solutionDir, project.path);
                const projectUri = vscode.Uri.file(absoluteProjectPath);
                const item = new SolutionItem(
                    project.name,
                    this.getCollapsibleState('project', projectUri),
                    projectUri,
                    'project',
                    undefined,
                    undefined,
                    solutionPath
                );
                (item as any).projectGuid = project.guid;
                regularProjects.push(item);
            }
        }

        // Sort solution folders alphabetically and add them first
        solutionFolders.sort((a, b) => a.label.localeCompare(b.label));
        items.push(...solutionFolders);

        // Sort projects alphabetically and add them after solution folders
        regularProjects.sort((a, b) => a.label.localeCompare(b.label));
        items.push(...regularProjects);

        return items;
    }

    private async getChildrenFromSolutionFolder(element: SolutionItem): Promise<SolutionItem[]> {
        const projectGuid = (element as any).projectGuid;
        if (!projectGuid) {
            return [];
        }

        const items: SolutionItem[] = [];

        // Add child entries (nested solution folders and projects)
        const childProjects = this.projectHierarchy.get(projectGuid) || [];
        if (childProjects.length > 0) {
            const childItems = await this.convertProjectsToSolutionItems(childProjects, element.solutionPath || '');
            items.push(...childItems);
        }

        // Add solution items (files) if present
        const solutionFile = this.parsedSolutions.get(element.solutionPath || '');
        if (solutionFile) {
            const project = solutionFile.projects.find(p => p.guid === projectGuid);
            if (project) {
                const solutionItems = SolutionFileParser.getSolutionItems(project);
                if (solutionItems.length > 0) {
                    const solutionDir = element.solutionPath ? path.dirname(element.solutionPath) : this.workspaceRoot || '';

                    for (const solutionItem of solutionItems.sort()) {
                        const filePath = path.resolve(solutionDir, solutionItem);
                        const fileUri = vscode.Uri.file(filePath);

                        const item = new SolutionItem(
                            path.basename(solutionItem),
                            vscode.TreeItemCollapsibleState.None,
                            fileUri,
                            'solutionItem',
                            undefined,
                            undefined, // projectPath
                            element.solutionPath // solutionPath
                        );

                        items.push(item);
                    }
                }
            }
        }

        return items;
    }


    // Methods to expose SolutionManager functionality
    async addProjectToSolution(solutionPath: string, projectPath: string): Promise<boolean> {
        if (!this.solutionManager) return false;
        const success = await this.solutionManager.addProject(solutionPath, projectPath);
        if (success) {
            this.refresh();
        }
        return success;
    }

    async removeProjectFromSolution(solutionPath: string, projectPath: string): Promise<boolean> {
        if (!this.solutionManager) return false;
        const success = await this.solutionManager.removeProject(solutionPath, projectPath);
        if (success) {
            this.refresh();
        }
        return success;
    }

    // Copy/Paste functionality
    copyFile(filePath: string): void {
        this.copiedFile = filePath;
        this.isCutOperation = false;
    }

    cutFile(filePath: string): void {
        this.copiedFile = filePath;
        this.isCutOperation = true;
    }

    async pasteFile(targetDir: string): Promise<boolean> {
        if (!this.copiedFile) {
            return false;
        }

        try {
            const fs = require('fs').promises;
            const path = require('path');

            const sourceFile = this.copiedFile;
            const fileName = path.basename(sourceFile);
            const fileExt = path.extname(fileName);
            const baseName = path.basename(fileName, fileExt);

            // Generate a unique filename
            let copyCounter = 1;
            let targetFileName = fileName;
            let targetPath = path.join(targetDir, targetFileName);

            // Check if file already exists and generate unique name
            while (await this.fileExists(targetPath)) {
                targetFileName = `${baseName} - Copy${copyCounter > 1 ? ` (${copyCounter})` : ''}${fileExt}`;
                targetPath = path.join(targetDir, targetFileName);
                copyCounter++;
            }

            // Copy or move the file based on operation type
            if (this.isCutOperation) {
                // Move the file for cut operation
                await fs.rename(sourceFile, targetPath);
                // Clear the copied file since cut operation is complete
                this.copiedFile = undefined;
                this.isCutOperation = false;
            } else {
                // Copy the file for copy operation
                await fs.copyFile(sourceFile, targetPath);
            }

            // Refresh the tree to show the changes
            this.refresh();

            return true;
        } catch (error) {
            this.logger.error('Error copying file:', error);
            return false;
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            const fs = require('fs').promises;
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    getCopiedFile(): string | undefined {
        return this.copiedFile;
    }

    isCutOperationActive(): boolean {
        return this.isCutOperation;
    }

    /**
     * Gets the GUID of a project by its file path
     */
    getProjectGuid(projectPath: string): string | null {
        for (const [solutionPath, solutionFile] of this.parsedSolutions) {
            for (const project of solutionFile.projects) {
                if (project.path === projectPath) {
                    return project.guid;
                }
                // Also check absolute path in case paths are relative
                const absolutePath = path.resolve(path.dirname(solutionPath), project.path);
                if (absolutePath === projectPath) {
                    return project.guid;
                }
            }
        }
        return null;
    }

    /**
     * Gets the current startup project GUID from the .sln.user file
     */
    async getCurrentStartupProject(solutionPath: string): Promise<string | null> {
        try {
            const { SolutionUserFile } = await import('../parsers/solutionUserFile');
            const userFile = new SolutionUserFile(solutionPath);
            return await userFile.getStartupProject();
        } catch (error) {
            this.logger.error('Error getting startup project:', error);
            return null;
        }
    }

    private async getFilesFromProject(projectUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        this.logger.info(`getFilesFromProject called for: ${projectUri.fsPath}`);

        // Try to use the Project instance from the active solution first
        const activeSolution = SolutionService.getActiveSolution();
        this.logger.info(`Active solution:`, activeSolution ? activeSolution.solutionPath : 'null');

        if (activeSolution) {
            const project = activeSolution.getProject(projectUri.fsPath);
            this.logger.info(`Found project instance:`, project ? project.name : 'null');

            if (project) {
                this.logger.info(`Using Project instance for: ${project.name}`);
                return this.getFilesFromProjectInstance(project);
            } else {
                this.logger.info(`No project instance found for: ${projectUri.fsPath}`);
                this.logger.info(`Available projects:`, Array.from(activeSolution.projects.keys()));
            }
        } else {
            this.logger.info(`No active solution available`);
        }

        // Fallback to manual parsing
        if (!this.projectFileParser) {
            return items;
        }

        try {
            const structure = await this.projectFileParser.parseProjectFiles(projectUri.fsPath);
            const projectDir = path.dirname(projectUri.fsPath);

            // Group files by directory
            const filesByDir = new Map<string, { name: string; path: string }[]>();
            filesByDir.set('', []); // Root files

            for (const file of structure.files) {
                if (file.isDirectory) {
                    continue; // We'll create folder items separately
                }

                const dirPath = path.dirname(file.relativePath);
                const normalizedDirPath = dirPath === '.' ? '' : dirPath;

                if (!filesByDir.has(normalizedDirPath)) {
                    filesByDir.set(normalizedDirPath, []);
                }

                const fileName = path.basename(file.relativePath);
                filesByDir.get(normalizedDirPath)!.push({
                    name: fileName,
                    path: file.path
                });
            }

            // Add Dependencies node first if there are any dependencies
            if (structure.dependencies && structure.dependencies.length > 0) {
                items.push(new SolutionItem(
                    'Dependencies',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    projectUri, // Use project URI as resource
                    'dependencies',
                    undefined,
                    projectUri.fsPath
                ));
            }

            // Add folders first (before files)
            const rootFolders = new Set<string>();
            for (const dir of structure.directories) {
                const parts = dir.split('/');
                if (parts.length === 1) {
                    rootFolders.add(parts[0]);
                }
            }

            // Sort folders alphabetically
            const sortedFolders = Array.from(rootFolders).sort();
            for (const folder of sortedFolders) {
                const folderPath = path.resolve(projectDir, folder);
                const folderUri = vscode.Uri.file(folderPath);
                this.logger.info(`Checking folder ${folder} (${folderPath})`);
                items.push(new SolutionItem(
                    folder,
                    this.getCollapsibleState('folder', folderUri),
                    folderUri,
                    'folder',
                    undefined,
                    projectUri.fsPath
                ));
            }

            // Then add root files with nesting (after folders)
            const rootFiles = filesByDir.get('') || [];
            const nestedFiles = FileNestingService.nestFiles(rootFiles);
            items.push(...this.convertNestedFilesToSolutionItems(nestedFiles, projectUri.fsPath));

        } catch (error) {
            this.logger.error('Error getting files from project:', error);
        }

        return items;
    }

    /**
     * Gets files from a Project instance using its own methods
     */
    private async getFilesFromProjectInstance(project: Project): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        try {
            this.logger.info(`Getting files from project instance: ${project.name}`);
            this.logger.info(`Project initialized: ${project.isInitialized}`);

            // Let the Project class handle getting its root children
            const rootChildren = await project.getRootChildren();
            this.logger.info(`Project returned ${rootChildren.length} root children`);

            // Convert project items to SolutionItems
            for (const child of rootChildren) {
                if (child.type === 'dependencies') {
                    // Create a Dependencies container node
                    items.push(new SolutionItem(
                        child.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        vscode.Uri.file(project.projectPath), // Use project URI as resource
                        'dependencies',
                        undefined,
                        project.projectPath
                    ));
                } else if (child.type === 'folder') {
                    const folderUri = vscode.Uri.file(child.path);
                    items.push(new SolutionItem(
                        child.name,
                        this.getCollapsibleState('folder', folderUri),
                        folderUri,
                        'folder',
                        undefined,
                        project.projectPath
                    ));
                } else if (child.type === 'file') {
                    const fileUri = vscode.Uri.file(child.path);
                    items.push(new SolutionItem(
                        child.name,
                        vscode.TreeItemCollapsibleState.None,
                        fileUri,
                        'file',
                        undefined,
                        project.projectPath
                    ));
                }
            }

            this.logger.info(`Converted to ${items.length} SolutionItems`);

        } catch (error) {
            this.logger.error('Error getting files from project instance:', error);
        }

        return items;
    }

    private convertNestedFilesToSolutionItems(nestedFiles: NestedFile[], projectPath: string): SolutionItem[] {
        const items: SolutionItem[] = [];

        for (const nestedFile of nestedFiles) {
            const fileUri = vscode.Uri.file(nestedFile.path);
            const hasChildren = nestedFile.children?.length;

            const item = new SolutionItem(
                nestedFile.name,
                hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                fileUri,
                'file',
                undefined,
                projectPath
            );

            // Store nested children for later retrieval
            if (hasChildren) {
                (item as any).nestedChildren = nestedFile.children;
            }

            items.push(item);
        }

        return items;
    }

    private async getFilesFromFolder(folderUri: vscode.Uri, projectPath: string): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        // Try to use the Project instance from the active solution first
        const activeSolution = SolutionService.getActiveSolution();
        if (activeSolution) {
            const project = activeSolution.getProject(projectPath);
            if (project) {
                return this.getFilesFromFolderProjectInstance(project, folderUri.fsPath);
            }
        }

        try {
            // Fallback: Use fast directory scanning instead of parsing entire project
            const folderPath = folderUri.fsPath;
            const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

            // Separate files and directories
            const files: string[] = [];
            const subDirs: string[] = [];

            for (const entry of entries) {
                const fullPath = path.join(folderPath, entry.name);

                if (entry.isDirectory()) {
                    // Skip common directories that shouldn't be shown
                    if (!shouldSkipDirectory(entry.name)) {
                        subDirs.push(entry.name);
                    }
                } else {
                    files.push(fullPath);
                }
            }

            // Add subfolders first (sorted alphabetically)
            for (const subDir of subDirs.sort()) {
                const subFolderPath = path.join(folderPath, subDir);
                const subFolderUri = vscode.Uri.file(subFolderPath);

                items.push(new SolutionItem(
                    subDir,
                    this.getCollapsibleState('folder', subFolderUri),
                    subFolderUri,
                    'folder',
                    undefined,
                    projectPath
                ));
            }

            // Then add files (after subfolders)
            if (files.length > 0) {
                const folderFiles = files.map(file => ({
                    name: path.basename(file),
                    path: file
                }));

                const nestedFolderFiles = FileNestingService.nestFiles(folderFiles);
                items.push(...this.convertNestedFilesToSolutionItems(nestedFolderFiles, projectPath));
            }

        } catch (error) {
            this.logger.error('Error getting files from folder:', error);
        }

        return items;
    }

    /**
     * Gets files from a folder using the Project instance's methods
     */
    private async getFilesFromFolderProjectInstance(project: Project, folderPath: string): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        try {
            this.logger.info(`Getting folder children for: ${folderPath}`);

            // Use the project's getFolderChildren method
            const children = await project.getFolderChildren(folderPath);
            this.logger.info(`Project returned ${children.length} children for folder`);

            for (const child of children) {
                if (child.type === 'folder') {
                    const folderUri = vscode.Uri.file(child.path);
                    items.push(new SolutionItem(
                        child.name,
                        this.getCollapsibleState('folder', folderUri),
                        folderUri,
                        'folder',
                        undefined,
                        project.projectPath
                    ));
                } else if (child.type === 'file') {
                    const fileUri = vscode.Uri.file(child.path);
                    items.push(new SolutionItem(
                        child.name,
                        vscode.TreeItemCollapsibleState.None,
                        fileUri,
                        'file',
                        undefined,
                        project.projectPath
                    ));
                }
            }

        } catch (error) {
            this.logger.error('Error getting files from folder using project instance:', error);
        }

        return items;
    }

    private async getDependenciesFromProject(projectUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];

        this.logger.info(`getDependenciesFromProject called for: ${projectUri.fsPath}`);

        // Try to use the Project instance from the active solution first
        const activeSolution = SolutionService.getActiveSolution();
        if (activeSolution) {
            const project = activeSolution.getProject(projectUri.fsPath);
            if (project) {
                this.logger.info(`Using Project instance for dependencies: ${project.name}`);
                for (const dep of project.dependencies) {
                    let label = dep.name;
                    if (dep.version) {
                        label = `${dep.name} (${dep.version})`;
                    }

                    items.push(new SolutionItem(
                        label,
                        vscode.TreeItemCollapsibleState.None,
                        undefined, // Dependencies don't have file URIs
                        'dependency',
                        undefined,
                        projectUri.fsPath,
                        undefined,
                        dep.type as 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference' | undefined,
                        dep.version
                    ));
                }
                this.logger.info(`Added ${items.length} dependencies from Project instance`);
                return items;
            } else {
                this.logger.info(`No Project instance found for dependencies`);
            }
        } else {
            this.logger.info(`No active solution for dependencies`);
        }

        // Fallback to manual parsing
        if (!this.projectFileParser) {
            return items;
        }

        try {
            const structure = await this.projectFileParser.parseProjectFiles(projectUri.fsPath);

            for (const dep of structure.dependencies) {
                let label = dep.name;
                if (dep.version) {
                    label = `${dep.name} (${dep.version})`;
                }

                items.push(new SolutionItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    undefined, // Dependencies don't have file URIs
                    'dependency',
                    undefined,
                    projectUri.fsPath,
                    undefined,
                    dep.type,
                    dep.version
                ));
            }

        } catch (error) {
            this.logger.error('Error getting dependencies from project:', error);
        }

        return items;
    }

    // Remove this method since we now use the shared function from constants
}