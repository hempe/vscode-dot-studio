import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SolutionManager } from './solutionManager';
import { ProjectFileParser } from './projectFileParser';
import { SolutionItem } from './solutionItem';
import { FileNestingService, NestedFile } from './fileNesting';


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

        try {
            const projects = await this.solutionManager.listProjects(solutionUri.fsPath);

            for (const project of projects) {
                const projectUri = vscode.Uri.file(project.path);

                items.push(new SolutionItem(
                    project.name,
                    this.getCollapsibleState('project', projectUri),
                    projectUri,
                    'project',
                    undefined,
                    undefined,
                    solutionUri.fsPath
                ));
            }
        } catch (error) {
            console.error('Error getting projects from solution:', error);
            // Fallback to manual parsing if dotnet CLI fails
            return this.getProjectsFromSolutionFallback(solutionUri);
        }

        return items;
    }

    private async getProjectsFromSolutionFallback(solutionUri: vscode.Uri): Promise<SolutionItem[]> {
        const items: SolutionItem[] = [];
        
        try {
            const solutionContent = await fs.promises.readFile(solutionUri.fsPath, 'utf8');
            const projectPaths = this.parseSolutionFile(solutionContent, path.dirname(solutionUri.fsPath));

            for (const projectPath of projectPaths) {
                const projectName = path.basename(projectPath, path.extname(projectPath));
                const projectUri = vscode.Uri.file(projectPath);

                items.push(new SolutionItem(
                    projectName,
                    this.getCollapsibleState('project', projectUri),
                    projectUri,
                    'project',
                    undefined,
                    undefined,
                    solutionUri.fsPath
                ));
            }
        } catch (error) {
            console.error('Error with fallback solution parsing:', error);
        }

        return items;
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
            
            // Process root files with nesting
            const rootFiles = filesByDir.get('') || [];
            const nestedFiles = FileNestingService.nestFiles(rootFiles);
            items.push(...this.convertNestedFilesToSolutionItems(nestedFiles, projectUri.fsPath));
            
            // Add folders and their immediate children
            const rootFolders = new Set<string>();
            for (const dir of structure.directories) {
                const parts = dir.split('/');
                if (parts.length === 1) {
                    rootFolders.add(parts[0]);
                }
            }
            
            for (const folder of rootFolders) {
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
        
        if (!this.projectFileParser) {
            return items;
        }

        try {
            const structure = await this.projectFileParser.parseProjectFiles(projectPath);
            const projectDir = path.dirname(projectPath);
            const folderRelativePath = path.relative(projectDir, folderUri.fsPath).replace(/\\/g, '/');
            
            // Get files in this specific folder
            const filesInFolder = structure.files.filter(file => {
                if (file.isDirectory) return false;
                const fileDir = path.dirname(file.relativePath);
                const normalizedFileDir = fileDir === '.' ? '' : fileDir;
                return normalizedFileDir === folderRelativePath;
            });
            
            // Convert files to nested structure and add to items
            const folderFiles = filesInFolder.map(file => ({
                name: path.basename(file.relativePath),
                path: file.path
            }));
            
            const nestedFolderFiles = FileNestingService.nestFiles(folderFiles);
            items.push(...this.convertNestedFilesToSolutionItems(nestedFolderFiles, projectPath));
            
            // Add subfolders
            const subFolders = new Set<string>();
            for (const dir of structure.directories) {
                if (dir.startsWith(folderRelativePath + '/')) {
                    const remainingPath = dir.substring(folderRelativePath.length + 1);
                    const nextLevel = remainingPath.split('/')[0];
                    subFolders.add(nextLevel);
                }
            }
            
            for (const subFolder of subFolders) {
                const subFolderPath = path.resolve(folderUri.fsPath, subFolder);
                const subFolderUri = vscode.Uri.file(subFolderPath);
                
                items.push(new SolutionItem(
                    subFolder,
                    this.getCollapsibleState('folder', subFolderUri),
                    subFolderUri,
                    'folder',
                    undefined,
                    projectPath
                ));
            }
            
        } catch (error) {
            console.error('Error getting files from folder:', error);
        }
        
        return items;
    }
}