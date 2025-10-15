import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileParser, ProjectFileStructure } from '../parsers/projectFileParser';
import { SolutionProject } from '../parsers/solutionFileParser';
import { shouldSkipDirectory, isExcluded } from '../core/constants';
import { FileNestingService, NestedFile } from '../services/fileNesting';
import { NodeId, NodeIdService } from '../services/nodeIdService';
import { logger } from './logger';
import { ProjectChild } from '../webview/solution-view/types';

export interface ProjectFileNode {
    name: string;
    path: string;
    type: 'file' | 'folder';
    children?: ProjectFileNode[];
    isLoaded?: boolean; // Track if children have been loaded
    hasChildren?: boolean; // Indicates if the node has children that can be loaded
}

export interface ProjectDependency {
    name: string;
    version?: string;
    type?: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference' | undefined;
}

const log = logger('Project');;
export class Project {
    private _disposables: vscode.Disposable[] = [];
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _projectStructure?: ProjectFileStructure;
    private _fileTree?: ProjectFileNode;
    private _dependencies: ProjectDependency[] = [];
    private _frameworks: string[] = [];
    private _changeEmitter = new vscode.EventEmitter<void>();
    private _isInitialized = false;
    private _collapsedState: Map<string, boolean> = new Map(); // Track expanded/collapsed state
    private _folderWatchers: Map<string, vscode.FileSystemWatcher> = new Map(); // Lazy folder watchers

    public readonly onDidChange = this._changeEmitter.event;

    constructor(
        private _projectPath: string,
        private _solutionProject: SolutionProject
    ) {
        this.initialize();
    }

    get projectPath(): string {
        return this._projectPath;
    }

    get solutionProject(): SolutionProject {
        return this._solutionProject;
    }

    get name(): string {
        return this._solutionProject.name || path.basename(this._projectPath, path.extname(this._projectPath));
    }

    get dependencies(): ProjectDependency[] {
        return this._dependencies;
    }

    get frameworks(): string[] {
        return this._frameworks;
    }

    get fileTree(): ProjectFileNode | undefined {
        return this._fileTree;
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    private async initialize(): Promise<void> {
        try {
            // Set up file watcher for the project folder
            this.setupFileWatcher();

            // Parse project file to get dependencies and frameworks
            await this.parseProjectFile();

            // Initialize root file tree structure (but don't load all files yet)
            await this.initializeFileTree();

            this._isInitialized = true;
            log.info(`Initialized project: ${this.name}`);
        } catch (error) {
            log.error(`Failed to initialize project ${this.name}:`, error);
            throw error;
        }
    }

    private setupFileWatcher(): void {
        const projectDir = path.dirname(this._projectPath);

        // Watch only the project file itself, not the entire directory
        // Folder-specific watchers will be created lazily when folders are expanded
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(projectDir, path.basename(this._projectPath))
        );

        this._fileWatcher.onDidCreate(this.handleFileCreated, this, this._disposables);
        this._fileWatcher.onDidChange(this.handleFileChanged, this, this._disposables);
        this._fileWatcher.onDidDelete(this.handleFileDeleted, this, this._disposables);

        this._disposables.push(this._fileWatcher);
    }

    private async handleFileCreated(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);

        // Skip excluded files (build artifacts, temp files, etc.)
        if (isExcluded(filePath, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)) {
            return;
        }

        log.debug(`File created: ${fileName}`);

        if (fileName === path.basename(this._projectPath)) {
            // Project file itself changed
            await this.parseProjectFile();
            this._changeEmitter.fire(); // Simple event - just notify change
        } else {
            // Other file created - update file tree if it's in a loaded area
            await this.handleFileSystemChange(filePath, 'created');
        }
    }

    private async handleFileChanged(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);

        // Skip excluded files (build artifacts, temp files, etc.)
        if (isExcluded(filePath, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)) {
            return;
        }

        if (fileName === path.basename(this._projectPath)) {
            log.info(`Project file changed: ${fileName}`);
            await this.parseProjectFile();
            this._changeEmitter.fire(); // Simple event - just notify change
        }
        // For other file changes, we don't need to do anything unless we want to show modification indicators
    }

    private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        // Skip excluded files (build artifacts, temp files, etc.)
        if (isExcluded(filePath, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)) {
            return;
        }

        log.debug(`File deleted: ${path.basename(filePath)}`);

        if (filePath === this._projectPath) {
            // Project file itself was deleted
            log.info(`Project file deleted: ${this.name}`);
            this.dispose();
        } else {
            // Other file deleted - update file tree
            await this.handleFileSystemChange(filePath, 'deleted');
        }
    }

    private async handleFileSystemChange(filePath: string, changeType: 'created' | 'deleted'): Promise<void> {
        // Only notify about file changes if the area of the tree where this file lives is loaded
        // This avoids unnecessary work for files in unexpanded folders
        const relativePath = path.relative(path.dirname(this._projectPath), filePath);

        if (this.isPathInLoadedArea(relativePath)) {
            log.debug(`File ${changeType} in loaded area: ${relativePath}`);

            // Invalidate the cache for the parent folder so it will be reloaded
            const parentDir = path.dirname(filePath);
            const parentNode = this.findNodeById(parentDir);
            if (parentNode) {
                log.info(`Invalidating cache for folder: ${parentDir}`);
                parentNode.isLoaded = false;
                parentNode.children = [];
            }

            this._changeEmitter.fire(); // Simple event - just notify change
        }
    }

    private isPathInLoadedArea(relativePath: string): boolean {
        // Check if the path is in an area of the tree that has been loaded
        // For now, we'll consider the root level as always loaded
        const pathSegments = relativePath.split(path.sep);

        // Root level files are always considered loaded
        if (pathSegments.length === 1) {
            return true;
        }

        // Check if parent folders are expanded
        let currentPath = '';
        for (let i = 0; i < pathSegments.length - 1; i++) {
            currentPath = currentPath ? path.join(currentPath, pathSegments[i]) : pathSegments[i];
            const fullPath = path.join(path.dirname(this._projectPath), currentPath);

            // If this folder is collapsed, then this file change is not in a loaded area
            if (this._collapsedState.get(fullPath) === true) {
                return false;
            }
        }

        return true;
    }

    private async parseProjectFile(): Promise<void> {
        try {
            const parser = new ProjectFileParser();

            this._projectStructure = await parser.parseProjectFiles(this._projectPath);
            this._dependencies = this._projectStructure.dependencies || [];
            this._frameworks = this._solutionProject.targetFrameworks || [];

            log.debug(`Parsed project ${this.name}: ${this._dependencies.length} dependencies, ${this._frameworks.length} frameworks`);
        } catch (error) {
            log.error(`Error parsing project file ${this.name}:`, error);
            this._dependencies = [];
            this._frameworks = [];
        }
    }

    private async initializeFileTree(): Promise<void> {
        const projectDir = path.dirname(this._projectPath);

        // Create root node but don't load all children immediately
        this._fileTree = {
            name: this.name,
            path: projectDir,
            type: 'folder',
            children: [], // Will be loaded on demand
            isLoaded: false
        };

        log.debug(`Initialized file tree for project: ${this.name}`);
    }

    /**
     * Loads children for a specific folder node (lazy loading)
     */
    async loadFolderChildren(folderPath: string): Promise<ProjectFileNode[]> {
        try {
            const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
            const children: ProjectFileNode[] = [];

            // Separate folders and files
            const folders: fs.Dirent[] = [];
            const rawFiles: fs.Dirent[] = [];

            for (const entry of entries) {
                if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
                    folders.push(entry);
                } else if (entry.isFile()) {
                    rawFiles.push(entry);
                }
            }

            // Add folders first (sorted)
            for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
                const folderFullPath = path.join(folderPath, folder.name);
                const hasChildren = await this.checkFolderHasChildren(folderFullPath);

                children.push({
                    name: folder.name,
                    path: folderFullPath,
                    type: 'folder',
                    children: [], // Will be loaded on demand
                    isLoaded: false,
                    hasChildren
                });
            }

            // Apply file nesting to files
            const fileList = rawFiles.map(file => ({
                name: file.name,
                path: path.join(folderPath, file.name)
            }));

            const nestedFiles = FileNestingService.nestFiles(fileList);

            // Convert nested files to ProjectFileNode structure
            const convertNestedFiles = (nestedFiles: NestedFile[]): ProjectFileNode[] => {
                return nestedFiles.map(nestedFile => {
                    const node: ProjectFileNode = {
                        name: nestedFile.name,
                        path: nestedFile.path,
                        type: 'file'
                    };

                    // If this file has nested children, add them and mark as expandable
                    if (nestedFile.children?.length) {
                        node.children = convertNestedFiles(nestedFile.children);
                        node.isLoaded = true; // Children are already loaded
                        node.hasChildren = true; // Mark as expandable so UI shows arrow
                    }

                    return node;
                });
            };

            children.push(...convertNestedFiles(nestedFiles));

            log.debug(`Loaded ${children.length} children for folder: ${folderPath} (with nesting)`);
            return children;
        } catch (error) {
            log.error(`Error loading folder children for ${folderPath}:`, error);
            return [];
        }
    }

    /**
     * Expands a folder node and loads its children if not already loaded
     */
    async expandFolder(folderPath: string): Promise<ProjectFileNode[]> {
        log.debug(`Expanding folder: ${folderPath}`);

        // Mark as expanded
        this._collapsedState.set(folderPath, false);

        // Find the node in the tree
        const node = this.findNodeById(folderPath);
        if (!node) {
            log.warn(`Could not find node for path: ${folderPath}`);
            return [];
        }

        // Load children if not already loaded
        if (!node.isLoaded) {
            node.children = await this.loadFolderChildren(folderPath);
            node.isLoaded = true;
        }

        return node.children || [];
    }

    /**
     * Collapses a folder node
     */
    collapseFolder(folderPath: string): void {
        log.debug(`Collapsing folder: ${folderPath}`);
        this._collapsedState.set(folderPath, true);
    }

    /**
     * Checks if a folder is expanded
     */
    isFolderExpanded(folderPath: string): boolean {
        return this._collapsedState.get(folderPath) === false;
    }

    /**
     * Gets the collapsed state for persistence
     */
    getCollapsedState(): Map<string, boolean> {
        return new Map(this._collapsedState);
    }

    /**
     * Sets the collapsed state from persistence
     */
    setCollapsedState(state: Map<string, boolean>): void {
        this._collapsedState = new Map(state);
    }

    /**
     * Finds a node in the file tree by its path
     */
    private findNodeById(targetPath: string): ProjectFileNode | undefined {
        if (!this._fileTree) return undefined;

        const findInNode = (node: ProjectFileNode): ProjectFileNode | undefined => {
            if (node.path === targetPath) {
                return node;
            }

            if (node.children) {
                for (const child of node.children) {
                    const found = findInNode(child);
                    if (found) return found;
                }
            }

            return undefined;
        };

        return findInNode(this._fileTree);
    }

    /**
     * Gets all loaded file paths (for UI updates)
     */
    getLoadedFilePaths(): string[] {
        const paths: string[] = [];

        const collectPaths = (node: ProjectFileNode) => {
            if (node.type === 'file') {
                paths.push(node.path);
            }

            if (node.children && node.isLoaded) {
                for (const child of node.children) {
                    collectPaths(child);
                }
            }
        };

        if (this._fileTree) {
            collectPaths(this._fileTree);
        }

        return paths;
    }

    /**
     * Quick check if project has any children without loading them
     */
    async hasAnyChildren(): Promise<boolean> {
        try {
            // Quick check for dependencies
            if (this._dependencies && this._dependencies.length > 0) {
                return true;
            }

            // Quick check for root level files/folders
            const projectDir = path.dirname(this._projectPath);

            try {
                const entries = await fs.promises.readdir(projectDir, { withFileTypes: true });

                // Check if there are any non-project files or folders
                for (const entry of entries) {
                    if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
                        return true; // Found a folder
                    } else if (entry.isFile()) {
                        // Skip project files
                        if (!(entry.name.endsWith('.csproj') ||
                            entry.name.endsWith('.vbproj') ||
                            entry.name.endsWith('.fsproj'))) {
                            return true; // Found a non-project file
                        }
                    }
                }

                return false; // No children found
            } catch (error) {
                log.error(`Error checking children for ${this.name}:`, error);
                return true; // Assume it has children on error
            }
        } catch (error) {
            log.error(`Error in hasAnyChildren for ${this.name}:`, error);
            return true; // Safe fallback
        }
    }

    /**
     * Quick check if a folder has any children without loading them
     */
    private async checkFolderHasChildren(folderPath: string): Promise<boolean> {
        try {
            const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

            // Check if there are any files or non-skipped directories
            for (const entry of entries) {
                if (entry.isFile()) {
                    return true; // Found a file
                } else if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
                    return true; // Found a non-skipped folder
                }
            }

            return false; // No children found
        } catch (error) {
            log.debug(`Error checking folder children for ${folderPath}:`, error);
            return false; // Safe fallback - assume no children on error
        }
    }

    /**
     * Gets the root-level children for this project (dependencies container + root files/folders)
     */
    async getRootChildren(): Promise<ProjectChild[]> {
        const items: ProjectChild[] = [];

        try {
            // Add Dependencies container if there are dependencies
            if (this._dependencies && this._dependencies.length > 0) {
                items.push({
                    type: 'dependencies',
                    name: 'Dependencies',
                    nodeId: NodeIdService.generateDependenciesId(this._projectPath),
                    hasChildren: true
                });
            }

            // Get root level files and folders
            const projectDir = path.dirname(this._projectPath);

            // Ensure root level is loaded
            if (this._fileTree && !this._fileTree.isLoaded) {
                await this.expandFolder(projectDir);
            }

            // Add root files and folders (excluding .csproj and other project files)
            if (this._fileTree?.children) {
                // First, find the Properties folder if it exists
                const propertiesFolder = this._fileTree.children.find(child =>
                    child.type === 'folder' && child.name === 'Properties'
                );

                // Add Properties folder right after Dependencies
                if (propertiesFolder) {
                    items.push({
                        type: 'folder',
                        name: propertiesFolder.name,
                        hasChildren: propertiesFolder.hasChildren,
                        nodeId: NodeIdService.generateFolderId(propertiesFolder.path, this._projectPath)
                    });
                }

                // Then add all other files and folders
                for (const child of this._fileTree.children) {
                    // Filter out project files
                    if (child.type === 'file' && (
                        child.name.endsWith('.csproj') ||
                        child.name.endsWith('.vbproj') ||
                        child.name.endsWith('.fsproj')
                    )) {
                        log.info(`Filtering out project file: ${child.name}`);
                        continue;
                    }

                    // Skip Properties folder since we already added it
                    if (child.type === 'folder' && child.name === 'Properties') {
                        continue;
                    }

                    const nodeId = child.type === 'folder'
                        ? NodeIdService.generateFolderId(child.path, this._projectPath)
                        : NodeIdService.generateFileId(child.path);

                    items.push({
                        type: child.type as 'folder' | 'file',
                        name: child.name,
                        hasChildren: child.hasChildren,
                        nodeId: nodeId
                    });
                }
            }

            log.info(`getRootChildren for ${this.name}: ${items.length} items`);
            return items;

        } catch (error) {
            log.error(`Error getting root children for ${this.name}:`, error);
            return [];
        }
    }

    /**
     * Gets dependency categories for this project (used when Dependencies node is expanded)
     */
    getDependencies(): ProjectChild[] {
        log.info(`getDependencies called for ${this.name}, found ${this._dependencies?.length || 0} dependencies`);

        // Always return the 3 main dependency categories - even if empty (so users can add dependencies via context menu)
        const items: ProjectChild[] = [
            {
                type: 'packageDependencies',
                name: 'Packages',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'packages'),
            },
            {
                type: 'projectDependencies',
                name: 'Projects',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'projects'),
            },
            {
                type: 'assemblyDependencies',
                name: 'Assemblies',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'assemblies'),
            }
        ];

        log.info(`getDependencies for ${this.name}: Always returning 3 dependency categories (Packages, Projects, Assemblies)`);
        return items;
    }

    /**
     * Gets dependencies for a specific category (used when dependency category node is expanded)
     */
    getDependenciesByCategory(nodeId: NodeId): ProjectChild[] {
        const items: ProjectChild[] = [];

        if (!this._dependencies) {
            return items;
        }

        let dependencies: ProjectDependency[] = [];
        let categoryName: string = '';

        // Determine which category - handle both legacy paths and new expansion IDs
        if (nodeId.categoryName == 'packages') {
            // Packages: NuGet package references
            dependencies = this._dependencies.filter(dep => dep.type === 'PackageReference');
            categoryName = 'packages';
        } else if (nodeId.categoryName == 'projects') {
            // Projects: project-to-project references
            dependencies = this._dependencies.filter(dep => dep.type === 'ProjectReference');
            categoryName = 'projects';
        } else if (nodeId.categoryName == 'assemblies') {
            // Assemblies: binary/assembly references
            dependencies = this._dependencies.filter(dep => dep.type === 'Reference');
            categoryName = 'assemblies';
        } else if (nodeId.categoryName == 'frameworks') {            // Frameworks: framework references
            dependencies = this._dependencies.filter(dep => dep.type === 'FrameworkReference');
            categoryName = 'frameworks';
        }

        // Convert to tree nodes
        for (const dep of dependencies) {
            // Create unique legacy path that includes version to handle same package with different versions
            const uniquePath = dep.version
                ? `${this._projectPath}/dependencies/${categoryName}/${dep.name}@${dep.version}`
                : `${this._projectPath}/dependencies/${categoryName}/${dep.name}`;

            // Generate expansion ID
            const nodeId = NodeIdService.generateDependencyId(
                this._projectPath,
                categoryName,
                dep.name,
                dep.version
            );

            items.push({
                type: 'dependency',
                name: dep.version ? `${dep.name} (${dep.version})` : dep.name,
                nodeId: nodeId,
                hasChildren: false
            });

            log.debug(`Created dependency node: ${dep.name} with path: ${uniquePath}, nodeId: ${nodeId}`);
        }

        log.info(`getDependenciesByCategory for ${nodeId}: ${items.length} dependencies`);
        return items;
    }

    /**
     * Gets children for a specific folder path within this project
     */
    async getFolderChildren(folderPath: string): Promise<ProjectChild[]> {
        const items: ProjectChild[] = [];

        try {
            const children = await this.expandFolder(folderPath);

            for (const child of children) {
                const nodeId = child.type === 'folder'
                    ? NodeIdService.generateFolderId(child.path, this._projectPath)
                    : NodeIdService.generateFileId(child.path);

                items.push({
                    type: child.type as 'folder' | 'file',
                    name: child.name,
                    hasChildren: child.hasChildren,
                    nodeId: nodeId
                });
            }

            log.info(`getFolderChildren for ${folderPath}: ${items.length} items`);
            return items;

        } catch (error) {
            log.error(`Error getting folder children for ${folderPath}:`, error);
            return [];
        }
    }

    /**
     * Forces a refresh of the project (re-parse project file and refresh loaded tree areas)
     */
    async refresh(): Promise<void> {
        log.info(`Forcing refresh of project: ${this.name}`);

        await this.parseProjectFile();

        // Re-load any expanded folders
        const expandedFolders = Array.from(this._collapsedState.entries())
            .filter(([_, isCollapsed]) => !isCollapsed)
            .map(([path, _]) => path);

        for (const folderPath of expandedFolders) {
            const node = this.findNodeById(folderPath);
            if (node) {
                node.children = await this.loadFolderChildren(folderPath);
                node.isLoaded = true;
            }
        }

        this._changeEmitter.fire(); // Simple event - just notify change
    }

    /**
     * Creates a folder watcher for a specific directory when it's expanded
     */
    public createFolderWatcher(folderPath: string): void {
        if (this._folderWatchers.has(folderPath)) {
            log.info(`Folder watcher already exists for: ${folderPath}`);
            return;
        }

        log.info(`Creating lazy folder watcher for: ${folderPath}`);

        try {
            // Watch the specific folder for file/directory changes
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folderPath, '*')
            );

            // Set up event handlers
            watcher.onDidCreate((uri) => {
                log.info(`File created in watched folder: ${uri.fsPath}`);
                this.handleFileCreated(uri);
            }, this, this._disposables);

            watcher.onDidChange((uri) => {
                log.info(`File changed in watched folder: ${uri.fsPath}`);
                this.handleFileChanged(uri);
            }, this, this._disposables);

            watcher.onDidDelete((uri) => {
                log.debug(`File deleted in watched folder: ${uri.fsPath}`);
                this.handleFileDeleted(uri);
            }, this, this._disposables);

            // Store the watcher
            this._folderWatchers.set(folderPath, watcher);
            this._disposables.push(watcher);

            log.info(`Folder watcher created for: ${folderPath}`);
        } catch (error) {
            log.error(`Failed to create folder watcher for ${folderPath}:`, error);
        }
    }

    /**
     * Removes a folder watcher when a directory is collapsed
     */
    public removeFolderWatcher(folderPath: string): void {
        const watcher = this._folderWatchers.get(folderPath);
        if (!watcher) {
            log.info(`No folder watcher to remove for: ${folderPath}`);
            return;
        }

        log.info(`Removing folder watcher for: ${folderPath}`);

        // Dispose the watcher
        watcher.dispose();
        this._folderWatchers.delete(folderPath);

        // Remove from disposables array
        const index = this._disposables.indexOf(watcher);
        if (index > -1) {
            this._disposables.splice(index, 1);
        }

        log.info(`Folder watcher removed for: ${folderPath}`);
    }

    /**
     * Disposes all folder watchers
     */
    private _disposeAllFolderWatchers(): void {
        log.info(`Disposing ${this._folderWatchers.size} folder watchers`);

        for (const [folderPath, watcher] of this._folderWatchers) {
            log.info(`Disposing folder watcher: ${folderPath}`);
            watcher.dispose();
        }

        this._folderWatchers.clear();
    }

    /**
     * Gets all currently watched folder paths
     */
    public getWatchedFolders(): string[] {
        return Array.from(this._folderWatchers.keys());
    }

    dispose(): void {
        log.info(`Disposing project: ${this.name}`);

        // Dispose event emitter
        this._changeEmitter.dispose();

        // Dispose all folder watchers first
        this._disposeAllFolderWatchers();

        // Dispose file watcher and other disposables
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];

        this._isInitialized = false;
    }
}