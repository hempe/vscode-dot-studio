import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileParser, ProjectFileStructure } from '../parsers/projectFileParser';
import { isExecutableProject } from '../parsers/projectKind';
import { parseTargetFrameworks } from '../parsers/targetFrameworks';
import { isTestProjectCandidate } from '../services/testing/testProjects';
import { CONNECTED_SERVICES, serviceFolderKind } from '../services/serviceReferences/connectedService';
import { grpcReferenceNodes } from '../services/grpc/grpcNodes';
import { SolutionProject } from '../types/solution';
import { shouldSkipDirectory, isExcluded } from '../core/constants';
import { FileNestingService, NestedFile } from '../services/fileNesting';
import { Settings } from '../services/settings';
import { NodeId, NodeIdService } from '../services/nodeIdService';
import { logger } from './logger';
import { ProjectChild } from '../types';
import { workspaceFolderOf } from '../services/workspaceFolders';
import { ProjectItemsService } from '../services/projectItems/projectItemsService';
import { layoutFolder, ItemState, BUILD_OUTPUT_FOLDERS } from '../services/projectItems/folderLayout';
import { ShowAllFiles } from '../services/showAllFiles';
import { holdsProject } from '../services/projectItems/projectItemEdits';
import { ProjectItems } from '../services/projectItems/projectItems';
import { changedSince, unlistedEntries } from '../services/projectItems/unseenFiles';
import { INCLUDED_ITEM, EXCLUDED_ITEM } from './contextMenus';
import { ProjectPackages } from '../services/nuget/centralPackages';
import { PackageVersionSource } from '../services/nuget/types';

export interface ProjectFileNode {
    name: string;
    path: string;
    type: 'file' | 'folder';
    children?: ProjectFileNode[];
    isLoaded?: boolean; // Track if children have been loaded
    hasChildren?: boolean; // Indicates if the node has children that can be loaded
    itemState?: ItemState; // What the project's items say about it (undefined while unknown)
}

export interface ProjectDependency {
    name: string;
    version?: string;
    type?: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference' | undefined;
    /** Packages: where the version comes from; undefined until MSBuild has evaluated the project */
    versionSource?: PackageVersionSource;
    /** Packages: the file the version is written in */
    versionFile?: string;
    /** Packages: the PackageReference is written in a props file (Directory.Build.props), not in the project file */
    inherited?: true;
}

/**
 * The project file's references with the packages as MSBuild evaluated them: versions from Directory.Packages.props
 * and VersionOverride, global packages, references from props files. Without an evaluation, the parser's list.
 */
function withEvaluatedPackages(parsed: readonly ProjectDependency[], packages: ProjectPackages | undefined): ProjectDependency[] {
    if (!packages) {
        return [...parsed];
    }
    return [
        ...packages.references.map(reference => ({
            name: reference.id,
            ...(reference.version ? { version: reference.version } : {}),
            type: 'PackageReference' as const,
            versionSource: reference.source,
            ...(reference.versionFile ? { versionFile: reference.versionFile } : {}),
            ...(reference.inherited ? { inherited: true as const } : {}),
        })),
        ...parsed.filter(dependency => dependency.type !== 'PackageReference'),
    ];
}

/** The tree's name of a reference: `Serilog (3.1.1)`, `Newtonsoft.Json (13.0.2, override)`, `X (8.0.0, global)` */
export function dependencyLabel(dependency: ProjectDependency): string {
    const source = dependency.versionSource === 'override' || dependency.versionSource === 'global' ? dependency.versionSource : undefined;
    const details = [dependency.version, source].filter(Boolean).join(', ');
    return details ? `${dependency.name} (${details})` : dependency.name;
}

const log = logger('Project');
const REEVALUATE_AFTER_CREATE_MS = 300;

export class Project {
    private _disposables: vscode.Disposable[] = [];
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _projectStructure?: ProjectFileStructure;
    private _fileTree?: ProjectFileNode;
    private _dependencies: ProjectDependency[] = [];
    private _frameworks: string[] = [];
    private _isExecutable = false;
    private _isTestProject = false;
    private _isSdkStyle = false;
    private _changeEmitter = new vscode.EventEmitter<void>();
    private _isInitialized = false;
    private _collapsedState: Map<string, boolean> = new Map(); // Track expanded/collapsed state
    private _folderWatchers: Map<string, vscode.FileSystemWatcher> = new Map(); // Lazy folder watchers
    private _reevaluateTimer?: ReturnType<typeof setTimeout>; // New files: evaluate once a burst is over
    private _retryTimer?: ReturnType<typeof setTimeout>; // A failed evaluation: try again after its delay
    private _evaluatedProjectFile?: string; // Stamp of the project file the last evaluation was asked for
    private _reevaluatedFor = new Set<string>(); // Unlisted entries (path and change time) that already asked for an evaluation

    public readonly onDidChange = this._changeEmitter.event;

    /**
     * @param _isUnloaded whether the user unloaded the project: then MSBuild does not evaluate it
     * @param _solutionProjects the project files of the solution: a folder holding one of them is not offered Exclude
     */
    constructor(
        private _projectPath: string,
        private _solutionProject: SolutionProject,
        private readonly _isUnloaded: () => boolean = () => false,
        private readonly _solutionProjects: () => readonly string[] = () => []
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

    /** The references; packages as MSBuild evaluated them once it has (Central Package Management versions, global packages) */
    get dependencies(): ProjectDependency[] {
        return withEvaluatedPackages(this._dependencies, ProjectItemsService.instance.packages(this._projectPath));
    }

    /** Whether the project can be started, i.e. can be the startup project */
    get isExecutable(): boolean {
        return this._isExecutable;
    }

    /** Whether the project references a test framework (it gets Run Tests / Debug Tests) */
    /** Neither started nor a test project: what Pack makes a NuGet package of */
    get isLibrary(): boolean {
        return !this._isExecutable && !this._isTestProject;
    }

    get isTestProject(): boolean {
        return this._isTestProject;
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
            void this.evaluateItems();
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
        if (isExcluded(filePath, workspaceFolderOf(filePath)?.uri.fsPath)) {
            return;
        }

        log.debug(`File created: ${fileName}`);

        if (fileName === path.basename(this._projectPath)) {
            // Project file itself changed
            await this.parseProjectFile();
            this._changeEmitter.fire(); // Simple event - just notify change
            await this.reevaluateItemsIfProjectFileChanged();
        } else {
            // Other file created: one the cached item list already includes (a checkout recreating it) needs no
            // MSBuild; an unknown one shows as excluded until evaluated again, once per burst of new files
            if (!ProjectItemsService.instance.get(this._projectPath)?.isIncluded(filePath)) {
                this.scheduleReevaluation();
            }
            await this.handleFileSystemChange(filePath, 'created');
        }
    }

    private async handleFileChanged(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);

        // Skip excluded files (build artifacts, temp files, etc.)
        if (isExcluded(filePath, workspaceFolderOf(filePath)?.uri.fsPath)) {
            return;
        }

        if (fileName === path.basename(this._projectPath)) {
            log.info(`Project file changed: ${fileName}`);
            await this.parseProjectFile();
            this._changeEmitter.fire(); // Simple event - just notify change
            await this.reevaluateItemsIfProjectFileChanged();
        }
        // For other file changes, we don't need to do anything unless we want to show modification indicators
    }

    private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        // Skip excluded files (build artifacts, temp files, etc.)
        if (isExcluded(filePath, workspaceFolderOf(filePath)?.uri.fsPath)) {
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
            const projectXml = await fs.promises.readFile(this._projectPath, 'utf8');
            // From the project file itself, so editing TargetFrameworks shows up without reloading the solution
            const declared = await parseTargetFrameworks(projectXml).catch(() => []);
            this._frameworks = declared.length > 0 ? declared : this._solutionProject.targetFrameworks || [];
            this._isExecutable = isExecutableProject(projectXml);
            this._isTestProject = isTestProjectCandidate(projectXml);
            this._isSdkStyle = /<Project\b[^>]*\bSdk\s*=/.test(projectXml) || /<Sdk\s+Name\s*=/.test(projectXml);

            log.debug(`Parsed project ${this.name}: ${this._dependencies.length} dependencies, ${this._frameworks.length} frameworks`);
        } catch (error) {
            log.error(`Error parsing project file ${this.name}:`, error);
            this._dependencies = [];
            this._frameworks = [];
            this._isExecutable = false;
            this._isTestProject = false;
            this._isSdkStyle = false;
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
            const showAll = ShowAllFiles.isOn();
            let entries: fs.Dirent[] = [];
            try {
                entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
            } catch (error) {
                // A folder that only exists because of linked files has nothing on disk
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }

            const disk = entries
                .filter(entry => entry.isFile() || (entry.isDirectory() && (!shouldSkipDirectory(entry.name) || (showAll && BUILD_OUTPUT_FOLDERS.includes(entry.name)))))
                .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
            const nonEmptyFolders = new Set<string>();
            for (const entry of disk.filter(entry => entry.isDirectory)) {
                const full = path.join(folderPath, entry.name);
                if (await this.checkFolderHasChildren(full)) {
                    nonEmptyFolders.add(full);
                }
            }
            // The last evaluation failed (the tree shows the plain disk listing): expanding tries again once its delay has passed
            if (ProjectItemsService.instance.retryDue(this._projectPath) && !this._isUnloaded()) {
                void this.evaluateItems();
            }
            const items = ProjectItemsService.instance.get(this._projectPath);
            const laidOut = layoutFolder(folderPath, disk, items, showAll, nonEmptyFolders);
            if (items) {
                await this.reevaluateIfNewerThanItems(folderPath, disk, items, nonEmptyFolders);
            }

            const children: ProjectFileNode[] = [];
            const folders = laidOut.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
            for (const folder of folders) {
                children.push({
                    name: folder.name,
                    path: folder.path,
                    type: 'folder',
                    children: [], // Will be loaded on demand
                    isLoaded: false,
                    // a disk folder can be empty and still hold linked files
                    hasChildren: nonEmptyFolders.has(folder.path) || folder.state === 'linked' || !!items?.hasLinkedUnder(folder.path),
                    ...(folder.state ? { itemState: folder.state } : {}),
                });
            }

            // Apply file nesting to files (the nested ones keep their own state through `files`)
            const files = laidOut.filter(entry => !entry.isDirectory);
            const fileStates = new Map(files.map(file => [file.path, file.state]));
            const fileList = files.map(file => ({ name: file.name, path: file.path }));

            const nestedFiles = FileNestingService.nestFiles(fileList, Settings.fileNesting());

            // Convert nested files to ProjectFileNode structure
            const convertNestedFiles = (nestedFiles: NestedFile[]): ProjectFileNode[] => {
                return nestedFiles.map(nestedFile => {
                    const node: ProjectFileNode = {
                        name: nestedFile.name,
                        path: nestedFile.path,
                        type: 'file',
                        ...(fileStates.get(nestedFile.path) ? { itemState: fileStates.get(nestedFile.path) } : {}),
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
            if (this.dependencies.length > 0) {
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
            if (this.dependencies.length > 0) {
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
                        nodeId: NodeIdService.generateFolderId(propertiesFolder.path),
                        contextValue: this.folderContextValue(propertiesFolder.path)
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

                    items.push(this.toProjectChild(child));
                }
            }

            // gRPC references and no Connected Services folder shown from disk: Visual Studio's node, at the top
            const connectedServices = NodeIdService.generateFolderId(path.join(projectDir, CONNECTED_SERVICES));
            if (!items.some(item => item.nodeId === connectedServices) && grpcReferenceNodes(this._projectPath).length > 0) {
                items.unshift({
                    type: 'connectedServices',
                    name: CONNECTED_SERVICES,
                    nodeId: NodeIdService.generateConnectedServicesId(this._projectPath),
                    hasChildren: true
                });
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
        const all = this.dependencies;
        log.info(`getDependencies called for ${this.name}, found ${all.length} dependencies`);

        // Count dependencies by type
        const packageCount = all.filter(dep => dep.type === 'PackageReference').length;
        const projectCount = all.filter(dep => dep.type === 'ProjectReference').length;
        const assemblyCount = all.filter(dep => dep.type === 'Reference').length;

        // Always return the 3 main dependency categories - even if empty (so users can add dependencies via context menu)
        const items: ProjectChild[] = [
            {
                // Listed by MSBuild when expanded; every SDK project has some
                type: 'dependencyCategory',
                name: 'Analyzers',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'analyzers'),
                contextValue: 'analyzers',
                hasChildren: true
            },
            {
                type: 'dependencyCategory',
                name: 'Packages',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'packages'),
                contextValue: 'packages',
                hasChildren: packageCount > 0
            },
            {
                type: 'dependencyCategory',
                name: 'Projects',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'projects'),
                contextValue: 'projects',
                hasChildren: projectCount > 0
            },
            {
                type: 'dependencyCategory',
                name: 'Assemblies',
                nodeId: NodeIdService.generateDependencyCategoryId(this._projectPath, 'assemblies'),
                contextValue: 'assemblies',
                hasChildren: assemblyCount > 0
            }
        ];

        log.info(`getDependencies for ${this.name}: Returning 3 dependency categories (Packages: ${packageCount}, Projects: ${projectCount}, Assemblies: ${assemblyCount})`);
        return items;
    }

    /**
     * Gets dependencies for a specific category (used when dependency category node is expanded)
     */
    getDependenciesByCategory(nodeId: NodeId): ProjectChild[] {
        const items: ProjectChild[] = [];
        const all = this.dependencies;

        let dependencies: ProjectDependency[] = [];
        let categoryName: string = '';

        // Determine which category - handle both legacy paths and new expansion IDs
        if (nodeId.type == 'dependencyCategory') {
            if (nodeId.name == 'packages') {
                // Packages: NuGet package references
                dependencies = all.filter(dep => dep.type === 'PackageReference');
                categoryName = 'packages';
            } else if (nodeId.name == 'projects') {
                // Projects: project-to-project references
                dependencies = all.filter(dep => dep.type === 'ProjectReference');
                categoryName = 'projects';
            } else if (nodeId.name == 'assemblies') {
                // Assemblies: binary/assembly references
                dependencies = all.filter(dep => dep.type === 'Reference');
                categoryName = 'assemblies';
            } else if (nodeId.name == 'frameworks') {            // Frameworks: framework references
                dependencies = all.filter(dep => dep.type === 'FrameworkReference');
                categoryName = 'frameworks';
            }
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
                name: dependencyLabel(dep),
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
    /** Marks `Connected Services` and the service reference folders in it for their context menus */
    private folderContextValue(folderPath: string): string | undefined {
        return serviceFolderKind(path.dirname(this._projectPath), folderPath);
    }

    /** A file or folder for the tree; files bring the files nested under them (Index.cshtml.cs under Index.cshtml) */
    private toProjectChild(node: ProjectFileNode): ProjectChild {
        const isFolder = node.type === 'folder';
        const itemValue = !this._isSdkStyle ? undefined
            : node.itemState === 'excluded' ? EXCLUDED_ITEM
            : node.itemState === 'included' && (!isFolder || this.canExcludeFolder(node.path)) ? INCLUDED_ITEM
            : undefined;
        const folderValue = isFolder ? this.folderContextValue(node.path) : undefined;
        return {
            type: node.type,
            name: node.name,
            // Connected Services also lists the gRPC references
            hasChildren: node.hasChildren || (folderValue === 'connectedServices' && grpcReferenceNodes(this._projectPath).length > 0),
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path) : NodeIdService.generateFileId(node.path),
            contextValue: folderValue ?? itemValue,
            ...(node.itemState === 'excluded' || node.itemState === 'linked' ? { itemState: node.itemState } : {}),
            // Folders load their children when expanded; nested files are known with their parent
            ...(!isFolder && node.children?.length ? { children: node.children.map(child => this.toProjectChild(child)) } : {}),
        };
    }

    /**
     * Exclude needs files of this project under the folder (an empty folder, or one holding only linked
     * files, would get a useless `Remove`), and the folder must not be another project of the solution
     */
    private canExcludeFolder(folderPath: string): boolean {
        const items = ProjectItemsService.instance.get(this._projectPath);
        return !!items && items.itemTypesUnder(folderPath).length > 0 && !holdsProject(folderPath, this._solutionProjects());
    }

    async getFolderChildren(folderPath: string): Promise<ProjectChild[]> {
        const items: ProjectChild[] = [];

        try {
            const children = await this.expandFolder(folderPath);

            for (const child of children) {
                items.push(this.toProjectChild(child));
            }
            // The gRPC references, after the service reference folders
            if (this.folderContextValue(folderPath) === 'connectedServices') {
                items.push(...grpcReferenceNodes(this._projectPath));
            }

            log.info(`getFolderChildren for ${folderPath}: ${items.length} items`);
            return items;

        } catch (error) {
            log.error(`Error getting folder children for ${folderPath}:`, error);
            return [];
        }
    }

    /** Asks MSBuild what the project contains, then shows the tree accordingly (it was drawn from the disk before) */
    async evaluateItems(): Promise<void> {
        if (this._isUnloaded()) {
            return;
        }
        const service = ProjectItemsService.instance;
        const before = service.version(this._projectPath);
        const packagesBefore = service.packagesVersion(this._projectPath);
        await service.evaluate(this._projectPath);
        this.scheduleRetry();
        // New package versions (Directory.Packages.props changed): Dependencies > Packages shows them
        const packagesChanged = service.packagesVersion(this._projectPath) !== packagesBefore;
        // Same list, or a failure that keeps the last one (or still none): the tree shows what it showed
        if (service.version(this._projectPath) === before) {
            if (packagesChanged) {
                this._changeEmitter.fire();
            }
            return;
        }
        // Nothing of the tree is shown yet (collapsed project): it reads the list when it is first expanded
        const anyExpanded = Array.from(this._collapsedState.values()).some(isCollapsed => !isCollapsed);
        if (!this._fileTree?.isLoaded && !anyExpanded) {
            if (packagesChanged) {
                this._changeEmitter.fire();
            }
            return;
        }
        await this.reloadLoadedFolders();
        this._changeEmitter.fire();
    }

    /** The project file or a props file changed, or the items were edited: evaluate again */
    async reevaluateItems(): Promise<void> {
        this._evaluatedProjectFile = this.projectFileStamp();
        ProjectItemsService.instance.invalidate(this._projectPath);
        await this.evaluateItems();
    }

    /**
     * A watcher saw the project file change. When it is the version an evaluation was already asked for (an edit
     * of ours like Include or Exclude, or a second watcher of the same folder), that evaluation reads it: no new one.
     */
    private async reevaluateItemsIfProjectFileChanged(): Promise<void> {
        const stamp = this.projectFileStamp();
        if (stamp !== undefined && stamp === this._evaluatedProjectFile) {
            return;
        }
        await this.reevaluateItems();
    }

    private projectFileStamp(): string | undefined {
        try {
            const stat = fs.statSync(this._projectPath);
            return `${stat.mtimeMs}|${stat.size}`;
        } catch {
            return undefined;
        }
    }

    /** A failed evaluation (timeout, half-saved project file) is tried again after a delay that grows with each failure */
    private scheduleRetry(): void {
        const delay = ProjectItemsService.instance.retryDelay(this._projectPath);
        if (delay === undefined || !this._isInitialized) {
            return;
        }
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
        }
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            void this.evaluateItems();
        }, delay);
    }

    /** New files may match a glob: evaluate again when no file was created for a moment */
    private scheduleReevaluation(): void {
        if (this._reevaluateTimer) {
            clearTimeout(this._reevaluateTimer);
        }
        this._reevaluateTimer = setTimeout(() => {
            this._reevaluateTimer = undefined;
            void this.reevaluateItems();
        }, REEVALUATE_AFTER_CREATE_MS);
    }

    /**
     * Folders not shown are not watched, so files created there meanwhile (a pull, a generator, while the extension
     * was not running) are missing from an item list evaluated before. When a folder is read from disk, entries the
     * list does not include but that changed after its evaluation may be such files: evaluate again (once per entry
     * and change), showing the cached list meanwhile. Genuinely excluded files are older and cost nothing.
     */
    private async reevaluateIfNewerThanItems(folderPath: string, disk: readonly { name: string; isDirectory: boolean }[],
        items: ProjectItems, nonEmptyFolders: ReadonlySet<string>): Promise<void> {
        const evaluatedAt = ProjectItemsService.instance.evaluatedAt(this._projectPath);
        if (evaluatedAt === undefined || this._isUnloaded()) {
            return;
        }
        const unlisted = unlistedEntries(folderPath, disk, items, nonEmptyFolders);
        if (unlisted.length === 0) {
            return;
        }
        const unseen = (await changedSince(unlisted, evaluatedAt))
            .map(entry => `${entry.path}|${entry.changedAt}`)
            .filter(key => !this._reevaluatedFor.has(key));
        if (unseen.length > 0) {
            log.debug(`Possibly new in ${folderPath}, evaluating again: ${unseen.join(', ')}`);
            unseen.forEach(key => this._reevaluatedFor.add(key));
            this.scheduleReevaluation();
        }
    }

    private async reloadLoadedFolders(): Promise<void> {
        const loaded = Array.from(this._collapsedState.entries()).filter(([, isCollapsed]) => !isCollapsed).map(([folderPath]) => folderPath);
        const projectDir = path.dirname(this._projectPath);
        const reloaded = new Set<ProjectFileNode>();
        for (const folderPath of [projectDir, ...loaded.filter(folderPath => folderPath !== projectDir)]) {
            const node = this.findNodeById(folderPath);
            if (node) {
                node.children = await this.loadFolderChildren(folderPath);
                node.isLoaded = true;
                reloaded.add(node);
            }
        }
        // Loaded but collapsed folders keep an old listing: read them again when they are expanded
        const forget = (node: ProjectFileNode): void => {
            for (const child of node.children ?? []) {
                if (child.isLoaded && !reloaded.has(child)) {
                    child.isLoaded = false;
                    child.children = [];
                } else {
                    forget(child);
                }
            }
        };
        if (this._fileTree) {
            forget(this._fileTree);
        }
    }

    /** Reads the loaded folders again (e.g. Show All Files was toggled) and redraws once */
    async reloadFileTree(): Promise<void> {
        await this.reloadLoadedFolders();
        this._changeEmitter.fire();
    }

    /**
     * Forces a refresh of the project (re-parse project file and refresh loaded tree areas)
     */
    async refresh(): Promise<void> {
        log.info(`Forcing refresh of project: ${this.name}`);

        await this.parseProjectFile();

        await this.reloadLoadedFolders();

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

        if (this._reevaluateTimer) {
            clearTimeout(this._reevaluateTimer);
            this._reevaluateTimer = undefined;
        }
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }

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