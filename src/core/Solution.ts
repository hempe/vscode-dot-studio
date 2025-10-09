import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SolutionFileParser, SolutionFile, SolutionProject } from '../parsers/solutionFileParser';
import { SolutionUserFile } from '../parsers/solutionUserFile';
import { Project } from './Project';
import { logger } from './logger';

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

const log = logger('Solution');

export class Solution {
    private _disposables: vscode.Disposable[] = [];
    private _changeEmitter = new vscode.EventEmitter<void>();
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _solutionFile?: SolutionFile;
    private _projects: Map<string, Project> = new Map();
    private _fileTree: Record<string, SolutionFileTreeNode> = {}; // Solution files tree structure
    private _userFile: SolutionUserFile;
    private _isInitialized = false;

    public readonly onDidChange = this._changeEmitter.event;

    constructor(private readonly _solutionPath: string) {
        this._userFile = new SolutionUserFile(_solutionPath);
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

    private async handleSolutionFileChanged(): Promise<void> {
        log.info('Solution file changed, reparsing...');

        try {
            await this.parseSolutionFile();

            // Notify UI that solution has changed
            this._changeEmitter.fire();

        } catch (error) {
            log.error('Error handling solution file change:', error);
        }
    }

    private handleSolutionFileDeleted(): void {
        log.info('Solution file deleted');
        this.dispose();
    }

    private async parseSolutionFile(): Promise<void> {
        try {
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            this._solutionFile = await SolutionFileParser.parse(solutionContent, path.dirname(this._solutionPath));

            // Build file tree for solution folders and solution items
            this.buildSolutionFileTree();

            log.debug(`Parsed solution with ${this._solutionFile.projects.length} projects`);
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
                    const project = new Project(absolutePath, solutionProject);

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

    /**
     * Adds a solution folder to the solution file
     */
    async addSolutionFolder(folderName: string, parentFolderName?: string): Promise<void> {
        log.info(`Adding solution folder: ${folderName}${parentFolderName ? ` under ${parentFolderName}` : ''}`);

        try {
            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

            // Generate a new GUID for the solution folder
            const folderGuid = `{${crypto.randomUUID().toUpperCase()}}`;
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
            let newLines = [
                ...lines.slice(0, insertIndex),
                folderEntry,
                folderEndEntry,
                ...lines.slice(insertIndex)
            ];

            // If this is a nested folder, we need to add/update the NestedProjects section
            if (parentFolderName) {
                // Find the parent folder's GUID
                const parentFolderGuid = this.findSolutionFolderGuid(parentFolderName);
                if (!parentFolderGuid) {
                    throw new Error(`Parent solution folder "${parentFolderName}" not found`);
                }

                // Add or update NestedProjects section
                newLines = this.addNestedProjectEntry(newLines, folderGuid, parentFolderGuid);
            }

            // Write the updated solution file
            const updatedContent = newLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

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
    private findSolutionFolderGuid(folderName: string): string | null {
        if (!this._solutionFile?.projects) {
            return null;
        }
        const folder = this._solutionFile.projects.find(
            p => p.name === folderName && SolutionFileParser.isSolutionFolder(p)
        );
        return folder ? folder.guid : null;
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
    async removeSolutionFolder(folderName: string): Promise<void> {
        log.info(`Removing solution folder: ${folderName}`);

        try {
            // Find the solution folder to get its GUID and capture it before removal
            const folderGuid = this.findSolutionFolderGuid(folderName);
            if (!folderGuid) {
                throw new Error(`Solution folder "${folderName}" not found`);
            }

            // Note: folder info captured but not currently used for event firing

            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

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
            const updatedContent = newLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

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
    async renameSolutionFolder(oldName: string, newName: string): Promise<void> {
        log.info(`Renaming solution folder from "${oldName}" to "${newName}"`);

        try {
            // Find the solution folder to get its GUID
            const folderGuid = this.findSolutionFolderGuid(oldName);
            if (!folderGuid) {
                throw new Error(`Solution folder "${oldName}" not found`);
            }

            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

            // Find and update the Project line for this solution folder
            const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
            const updatedLines = lines.map(line => {
                const trimmedLine = line.trim();

                // Check if this is the Project line for our solution folder
                if (trimmedLine.includes(`Project("${solutionFolderTypeGuid}")`) &&
                    trimmedLine.includes(`"${oldName}"`) &&
                    trimmedLine.includes(folderGuid)) {
                    // Replace the old name with the new name in the Project line
                    // Format: Project("{guid}") = "OldName", "OldName", "{folder-guid}"
                    return line.replace(new RegExp(`"${oldName}"`, 'g'), `"${newName}"`);
                }

                return line;
            });

            // Write the updated solution file
            const updatedContent = updatedLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

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
    async addSolutionItem(folderName: string, filePath: string): Promise<void> {
        log.info(`Adding solution item "${filePath}" to folder "${folderName}"`);

        try {
            // Find the solution folder to get its GUID
            const folderGuid = this.findSolutionFolderGuid(folderName);
            if (!folderGuid) {
                throw new Error(`Solution folder "${folderName}" not found`);
            }

            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this._solutionPath);
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            // Find the solution folder's Project block and add the file to it
            const updatedLines = this.addSolutionItemToFolder(lines, folderName, folderGuid, relativePath);

            // Write the updated solution file
            const updatedContent = updatedLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

            log.info(`Successfully added solution item "${path.basename(filePath)}" to folder "${folderName}"`);

            // Re-parse the solution file to update internal state
            await this.parseSolutionFile();

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error adding solution item:`, error);
            throw error;
        }
    }

    async removeSolutionItem(filePath: string): Promise<void> {
        log.info(`Removing solution item from solution: ${filePath}`);

        try {
            // Read the current solution file
            const solutionContent = await fs.promises.readFile(this._solutionPath, 'utf8');
            const lines = solutionContent.split('\n');

            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this._solutionPath);
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            // Remove the file reference from the solution file
            const updatedLines = this.removeSolutionItemFromFile(lines, relativePath);

            // Write the updated solution file
            const updatedContent = updatedLines.join('\n');
            await fs.promises.writeFile(this._solutionPath, updatedContent, 'utf8');

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
    private addSolutionItemToFolder(lines: string[], folderName: string, folderGuid: string, relativePath: string): string[] {
        const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
        let projectStartIndex = -1;
        let projectEndIndex = -1;

        // Find the Project/EndProject block for this solution folder
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line for this solution folder
            if (line.includes(`Project("${solutionFolderTypeGuid}")`) &&
                line.includes(`"${folderName}"`) &&
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
            throw new Error(`Could not find Project block for solution folder "${folderName}"`);
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
     * Adds a project to the solution file
     */
    async addProject(projectPath: string): Promise<void> {
        log.info(`Adding project to solution: ${projectPath}`);

        try {
            // Use the dotnet CLI command to add the project
            const relativePath = path.relative(path.dirname(this._solutionPath), projectPath);
            const command = `dotnet sln "${this._solutionPath}" add "${relativePath}"`;

            log.debug(`Executing: ${command}`);

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            const solutionDir = path.dirname(this._solutionPath);

            await execAsync(command, { cwd: solutionDir });

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
     * Removes a project from the solution file
     */
    async removeProject(projectPath: string): Promise<void> {
        log.info(`Removing project from solution: ${projectPath}`);

        try {
            // Use the dotnet CLI command to remove the project
            const relativePath = path.relative(path.dirname(this._solutionPath), projectPath);
            const command = `dotnet sln "${this._solutionPath}" remove "${relativePath}"`;

            log.debug(`Executing: ${command}`);

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            const solutionDir = path.dirname(this._solutionPath);

            await execAsync(command, { cwd: solutionDir });

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

    /**
     * Sets the startup project for the solution
     */
    async setStartupProject(projectPath: string): Promise<void> {
        try {
            // Find the project by path to get its GUID
            const project = this._solutionFile?.projects.find(p => p.path === projectPath);
            if (!project) {
                throw new Error(`Project not found: ${projectPath}`);
            }

            // Use the SolutionUserFile to set the startup project
            await this._userFile.setStartupProject(project.guid);

            // Emit change event to refresh the UI
            this._changeEmitter.fire();

            log.info(`Set startup project: ${projectPath} (${project.guid})`);
        } catch (error) {
            log.error('Error setting startup project:', error);
            throw error;
        }
    }

    /**
     * Gets the current startup project GUID
     */
    async getStartupProject(): Promise<string | null> {
        try {
            return await this._userFile.getStartupProject();
        } catch (error) {
            log.error('Error getting startup project:', error);
            return null;
        }
    }
}