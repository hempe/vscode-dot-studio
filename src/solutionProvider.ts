import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SolutionManager } from './solutionManager';
import { ProjectFileParser } from './projectFileParser';
import { SolutionItem } from './solutionItem';
import { FileNestingService, NestedFile } from './fileNesting';
import { shouldSkipDirectory, isRelevantFileExtension } from './constants';

interface SolutionEntry {
    type: 'project' | 'solutionFolder';
    name: string;
    path?: string; // Only for projects
    guid: string;
    parentGuid?: string; // For nested relationships
    children?: SolutionEntry[]; // Child entries
}


export class SolutionProvider implements vscode.TreeDataProvider<SolutionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SolutionItem | undefined | null | void> = new vscode.EventEmitter<SolutionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SolutionItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private solutionManager?: SolutionManager;
    private projectFileParser?: ProjectFileParser;
    private expandedItems = new Set<string>(); // Track expanded items by their resource path
    private copiedFile?: string; // Track copied file path for paste operations

    constructor(private workspaceRoot?: string) { 
        if (workspaceRoot) {
            this.solutionManager = new SolutionManager(workspaceRoot);
            this.projectFileParser = new ProjectFileParser(workspaceRoot);
        }
    }

    refresh(): void {
        // Clear parser cache to ensure fresh data
        if (this.projectFileParser) {
            this.projectFileParser.clearCache();
        }
        this._onDidChangeTreeData.fire(undefined);
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

    private isExpanded(resourcePath: string): boolean {
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
        return element;
    }

    getChildren(element?: SolutionItem): Thenable<SolutionItem[]> {
        if (!this.workspaceRoot) {
            return Promise.resolve([]);
        }

        if (!element) {
            return this.getSolutionAndProjects();
        }

        if (element.itemType === 'solution' && element.resourceUri) {
            return this.getProjectsFromSolution(element.resourceUri);
        }

        if (element.itemType === 'project' && element.resourceUri) {
            return this.getFilesFromProject(element.resourceUri);
        }

        if (element.itemType === 'folder' && element.resourceUri && element.projectPath) {
            return this.getFilesFromFolder(element.resourceUri, element.projectPath);
        }

        if (element.itemType === 'file' && (element as any).nestedChildren) {
            // Handle nested files (e.g., expanding EditUser.cshtml to show EditUser.cshtml.cs)
            const nestedChildren = (element as any).nestedChildren as NestedFile[];
            return Promise.resolve(this.convertNestedFilesToSolutionItems(nestedChildren, element.projectPath || ''));
        }

        if (element.itemType === 'dependencies' && element.resourceUri) {
            return this.getDependenciesFromProject(element.resourceUri);
        }

        if (element.itemType === 'solutionFolder') {
            return this.getChildrenFromSolutionFolder(element);
        }

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
                const projectName = path.basename(projectFile.fsPath, path.extname(projectFile.fsPath));
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

        // Always use manual parsing to get both projects and solution folders
        // The dotnet CLI only returns projects, not solution folders
        return this.getProjectsFromSolutionFallback(solutionUri);
    }

    private solutionEntryMap = new Map<string, SolutionEntry>(); // Cache for solution entries

    private async getProjectsFromSolutionFallback(solutionUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];
        
        try {
            const solutionContent = await fs.promises.readFile(solutionUri.fsPath, 'utf8');
            const solutionEntries = this.parseSolutionFileExtended(solutionContent, path.dirname(solutionUri.fsPath));

            // Clear and rebuild entry cache
            this.solutionEntryMap.clear();
            this.buildEntryMap(solutionEntries);

            return this.convertEntriesToSolutionItems(solutionEntries, solutionUri.fsPath);
        } catch (error) {
            console.error('Error with fallback solution parsing:', error);
        }

        return items;
    }

    private buildEntryMap(entries: SolutionEntry[]): void {
        for (const entry of entries) {
            this.solutionEntryMap.set(entry.guid, entry);
            if (entry.children) {
                this.buildEntryMap(entry.children);
            }
        }
    }

    private convertEntriesToSolutionItems(entries: SolutionEntry[], solutionPath: string): SolutionItem[] {
        const items: SolutionItem[] = [];

        // First add solution folders
        for (const entry of entries) {
            if (entry.type === 'solutionFolder') {
                const item = new SolutionItem(
                    entry.name,
                    this.getCollapsibleState('solutionFolder', undefined, vscode.TreeItemCollapsibleState.Collapsed),
                    undefined, // Solution folders don't have file URIs
                    'solutionFolder',
                    undefined,
                    undefined,
                    solutionPath
                );
                // Store the entry GUID so we can find children later
                (item as any).entryGuid = entry.guid;
                items.push(item);
            }
        }

        // Then add projects
        for (const entry of entries) {
            if (entry.type === 'project' && entry.path) {
                const projectUri = vscode.Uri.file(entry.path);
                const item = new SolutionItem(
                    entry.name,
                    this.getCollapsibleState('project', projectUri),
                    projectUri,
                    'project',
                    undefined,
                    undefined,
                    solutionPath
                );
                (item as any).entryGuid = entry.guid;
                items.push(item);
            }
        }

        return items;
    }

    private async getChildrenFromSolutionFolder(element: SolutionItem): Promise<SolutionItem[]> {
        const entryGuid = (element as any).entryGuid;
        if (!entryGuid) {
            return [];
        }

        const entry = this.solutionEntryMap.get(entryGuid);
        if (!entry || !entry.children) {
            return [];
        }

        return this.convertEntriesToSolutionItems(entry.children, element.solutionPath || '');
    }

    private parseSolutionFile(content: string, solutionDir: string): string[] {
        const projectPaths: string[] = [];
        const projectRegex = /Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]*\.(?:csproj|vbproj|fsproj))",/g;

        let match;
        while ((match = projectRegex.exec(content)) !== null) {
            const relativePath = match[1].replace(/\\/g, '/');
            const absolutePath = path.resolve(solutionDir, relativePath);
            projectPaths.push(absolutePath);
        }

        return projectPaths;
    }

    private parseSolutionFileExtended(content: string, solutionDir: string): SolutionEntry[] {
        const entries: SolutionEntry[] = [];
        const entryMap = new Map<string, SolutionEntry>(); // GUID -> Entry mapping
        
        // First pass: Parse all projects and solution folders
        const projectRegex = /Project\("([^"]*)"\)\s*=\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/g;

        let match;
        while ((match = projectRegex.exec(content)) !== null) {
            const [, typeGuid, name, pathOrName, itemGuid] = match;
            
            let entry: SolutionEntry;
            
            // Solution folder GUID: {2150E333-8FDC-42A3-9474-1A3956D46DE8}
            if (typeGuid === '{2150E333-8FDC-42A3-9474-1A3956D46DE8}') {
                entry = {
                    type: 'solutionFolder',
                    name: name,
                    guid: itemGuid,
                    children: []
                };
            } else if (pathOrName.match(/\.(csproj|vbproj|fsproj)$/)) {
                // It's a project
                const relativePath = pathOrName.replace(/\\/g, '/');
                const absolutePath = path.resolve(solutionDir, relativePath);
                entry = {
                    type: 'project',
                    name: name,
                    path: absolutePath,
                    guid: itemGuid
                };
            } else {
                // Skip unknown project types
                continue;
            }
            
            entries.push(entry);
            entryMap.set(itemGuid, entry);
        }

        // Second pass: Parse nested relationships from GlobalSection(NestedProjects)
        const nestedProjectsRegex = /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/;
        const nestedMatch = nestedProjectsRegex.exec(content);
        
        if (nestedMatch) {
            const nestedSection = nestedMatch[1];
            const nestedLines = nestedSection.split('\n');
            
            for (const line of nestedLines) {
                const trimmedLine = line.trim();
                if (trimmedLine && trimmedLine.includes('=')) {
                    const [childGuid, parentGuid] = trimmedLine.split('=').map(g => g.trim());
                    
                    const childEntry = entryMap.get(childGuid);
                    const parentEntry = entryMap.get(parentGuid);
                    
                    if (childEntry && parentEntry) {
                        // Set parent-child relationship
                        childEntry.parentGuid = parentGuid;
                        if (parentEntry.children) {
                            parentEntry.children.push(childEntry);
                        }
                    }
                }
            }
        }

        // Return only root level entries (no parentGuid)
        return entries.filter(entry => !entry.parentGuid);
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

    async getAvailableProjects(): Promise<string[]> {
        if (!this.solutionManager) return [];
        return this.solutionManager.getAvailableProjects();
    }

    // Copy/Paste functionality
    copyFile(filePath: string): void {
        this.copiedFile = filePath;
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
            
            // Copy the file
            await fs.copyFile(sourceFile, targetPath);
            
            // Refresh the tree to show the new file
            this.refresh();
            
            return true;
        } catch (error) {
            console.error('Error copying file:', error);
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

    private async getFilesFromProject(projectUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];
        
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
            console.error('Error getting files from project:', error);
        }
        
        return items;
    }

    private convertNestedFilesToSolutionItems(nestedFiles: NestedFile[], projectPath: string): SolutionItem[] {
        const items: SolutionItem[] = [];
        
        for (const nestedFile of nestedFiles) {
            const fileUri = vscode.Uri.file(nestedFile.path);
            const hasChildren = nestedFile.children && nestedFile.children.length > 0;
            
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
        
        try {
            // Use fast directory scanning instead of parsing entire project
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
                    // Only include relevant file types
                    const ext = path.extname(entry.name);
                    if (isRelevantFileExtension(ext)) {
                        files.push(fullPath);
                    }
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
            console.error('Error getting files from folder:', error);
        }
        
        return items;
    }

    private async getDependenciesFromProject(projectUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];
        
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
            console.error('Error getting dependencies from project:', error);
        }
        
        return items;
    }

    // Remove this method since we now use the shared function from constants
}