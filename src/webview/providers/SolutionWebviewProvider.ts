import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { FileNestingService } from '../../services/fileNesting';
import { ProjectFileParser } from '../../parsers/projectFileParser';
import { SolutionFileParser, SolutionProject } from '../../parsers/solutionFileParser';
import { NodeType } from '../solution-view/types';

interface DirectoryNode {
    name: string;
    path: string;
    type: 'directory';
    children: Map<string, DirectoryNode>;
    files: FileItem[];
}

interface FileItem {
    name: string;
    path: string;
    type: 'file';
}

export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _solutionService: SolutionService,
        private readonly _frameworkService: FrameworkDropdownService
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            []
        );

        // Send initial data when webview is ready
        this._updateWebview();
    }

    private async _handleMessage(message: any) {
        console.log('[SolutionWebviewProvider] Received message:', message);

        switch (message.command) {
            case 'getSolutionData':
                console.log('[SolutionWebviewProvider] Handling getSolutionData request');
                await this._updateWebview();
                break;

            case 'setFramework':
                console.log('[SolutionWebviewProvider] Handling setFramework request:', message.framework);
                await this._frameworkService.setActiveFramework(message.framework);
                break;

            case 'projectAction':
                console.log('[SolutionWebviewProvider] Handling projectAction:', {
                    action: message.action,
                    projectPath: message.projectPath,
                    data: message.data
                });
                await this._handleProjectAction(message.action, message.projectPath, message.data);
                break;

            case 'openFile':
                console.log('[SolutionWebviewProvider] Handling direct openFile request:', message.projectPath);
                if (message.projectPath) {
                    const uri = vscode.Uri.file(message.projectPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;

            default:
                console.log('[SolutionWebviewProvider] Unknown message command:', message.command);
        }
    }

    private async _handleProjectAction(action: string, projectPath: string, data?: any) {
        console.log(`[SolutionWebviewProvider] Executing project action: ${action} on ${projectPath}`);

        switch (action) {
            case 'openFile':
                console.log(`[SolutionWebviewProvider] Opening file: ${projectPath}`);
                await this._handleOpenFile(projectPath);
                break;

            case 'contextMenu':
                console.log(`[SolutionWebviewProvider] Context menu action for ${data?.type || 'unknown'} at ${projectPath}`);
                // Handle context menu actions based on data.type
                break;

            case 'rename':
                console.log(`[SolutionWebviewProvider] Renaming ${data?.oldName} to ${data?.newName} at ${projectPath}`);
                await this._handleRename(projectPath, data?.newName, data?.oldName, data?.type);
                break;

            case 'build':
                console.log(`[SolutionWebviewProvider] Building project: ${projectPath}`);
                await this._handleBuild(projectPath, 'build');
                break;

            case 'rebuild':
                console.log(`[SolutionWebviewProvider] Rebuilding project: ${projectPath}`);
                await this._handleBuild(projectPath, 'rebuild');
                break;

            case 'clean':
                console.log(`[SolutionWebviewProvider] Cleaning project: ${projectPath}`);
                await this._handleBuild(projectPath, 'clean');
                break;

            case 'deleteFile':
                console.log(`[SolutionWebviewProvider] Deleting file: ${projectPath}`);
                await this._handleDelete(projectPath, data?.type);
                break;

            case 'revealInExplorer':
                console.log(`[SolutionWebviewProvider] Revealing in explorer: ${projectPath}`);
                await this._handleRevealInExplorer(projectPath);
                break;

            default:
                console.warn(`[SolutionWebviewProvider] Unknown project action: ${action}`);
        }
    }

    private async _handleRename(oldPath: string, newName: string, oldName: string, nodeType: NodeType) {
        try {
            console.log(`[SolutionWebviewProvider] Attempting to rename ${nodeType} from "${oldName}" to "${newName}"`);

            // Set flag to prevent file watcher from triggering refresh
            this._isRenaming = true;

            const path = require('path');
            const fs = require('fs').promises;

            // Calculate new path
            const directory = path.dirname(oldPath);
            const originalExtension = path.extname(oldPath);

            // For files and solutions, check if user included extension in newName
            let finalNewName = newName;
            if (nodeType === 'file' || nodeType === 'solution') {
                const userProvidedExtension = path.extname(newName);
                if (!userProvidedExtension && originalExtension) {
                    // User didn't provide extension, add the original one
                    finalNewName = newName + originalExtension;
                }
                // If user provided extension, use newName as-is
            }

            const newPath = path.join(directory, finalNewName);

            console.log(`[SolutionWebviewProvider] Renaming path: ${oldPath} -> ${newPath}`);

            // Use VS Code's workspace API to rename the file/folder
            const oldUri = vscode.Uri.file(oldPath);
            const newUri = vscode.Uri.file(newPath);

            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(oldUri, newUri);

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                console.log(`[SolutionWebviewProvider] Successfully renamed ${oldName} to ${newName}`);
                // Send a targeted update instead of full refresh to preserve tree state
                this._view?.webview.postMessage({
                    command: 'nodeRenamed',
                    oldPath: oldPath,
                    newPath: newPath,
                    newName: path.basename(finalNewName)
                });
            } else {
                console.error(`[SolutionWebviewProvider] Failed to rename ${oldName} to ${newName}`);
                vscode.window.showErrorMessage(`Failed to rename ${oldName} to ${newName}`);
            }
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error during rename:`, error);
            vscode.window.showErrorMessage(`Error renaming file: ${error}`);
        } finally {
            // Clear the flag and allow refreshes again after a short delay
            setTimeout(() => {
                this._isRenaming = false;
                console.log('[SolutionWebviewProvider] Rename operation completed, refreshes allowed again');
            }, 1000); // 1 second delay to allow file system events to settle
        }
    }

    private async _handleBuild(projectPath: string, action: 'build' | 'rebuild' | 'clean') {
        try {
            const terminal = vscode.window.createTerminal(`${action} ${projectPath}`);
            terminal.show();

            let command: string;
            switch (action) {
                case 'build':
                    command = `dotnet build "${projectPath}"`;
                    break;
                case 'rebuild':
                    command = `dotnet clean "${projectPath}" && dotnet build "${projectPath}"`;
                    break;
                case 'clean':
                    command = `dotnet clean "${projectPath}"`;
                    break;
            }

            terminal.sendText(command);
            console.log(`[SolutionWebviewProvider] Executed ${action} command: ${command}`);
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }

    private async _handleOpenFile(filePath: string) {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
            console.log(`[SolutionWebviewProvider] Opened file: ${filePath}`);
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error opening file:`, error);
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    private async _handleDelete(itemPath: string, itemType?: string) {
        try {
            const uri = vscode.Uri.file(itemPath);
            const fileName = require('path').basename(itemPath);

            const confirmMessage = itemType === 'folder'
                ? `Are you sure you want to delete the folder "${fileName}" and all its contents?`
                : `Are you sure you want to delete "${fileName}"?`;

            const result = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Delete'
            );

            if (result === 'Delete') {
                await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
                console.log(`[SolutionWebviewProvider] Deleted: ${itemPath}`);
                this._updateWebview(); // Refresh to show changes
            }
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error deleting item:`, error);
            vscode.window.showErrorMessage(`Error deleting item: ${error}`);
        }
    }

    private async _handleRevealInExplorer(itemPath: string) {
        try {
            const uri = vscode.Uri.file(itemPath);
            await vscode.commands.executeCommand('revealFileInOS', uri);
            console.log(`[SolutionWebviewProvider] Revealed in explorer: ${itemPath}`);
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error revealing in explorer:`, error);
            vscode.window.showErrorMessage(`Error revealing in explorer: ${error}`);
        }
    }

    private async _updateWebview() {
        console.log('[SolutionWebviewProvider] Updating webview...');

        if (!this._view) {
            console.log('[SolutionWebviewProvider] No webview available, skipping update');
            return;
        }

        try {
            // Show loading state immediately
            console.log('[SolutionWebviewProvider] Sending loading message to webview');
            this._view.webview.postMessage({
                command: 'loading',
                message: 'Loading solution...'
            });

            // Load data asynchronously to prevent blocking
            console.log('[SolutionWebviewProvider] Loading solution data and frameworks...');
            const [solutionData, frameworks] = await Promise.all([
                this._getSolutionData(),
                this._frameworkService.getAvailableFrameworks()
            ]);

            const activeFramework = this._frameworkService.getActiveFramework();

            console.log('[SolutionWebviewProvider] Loaded data:', {
                projectCount: solutionData.length,
                frameworkCount: frameworks?.length || 0,
                activeFramework
            });

            console.log('[SolutionWebviewProvider] Sending solution data to webview');
            this._view.webview.postMessage({
                command: 'solutionData',
                data: {
                    projects: solutionData,
                    frameworks: frameworks || [],
                    activeFramework
                }
            });
        } catch (error) {
            console.error('[SolutionWebviewProvider] Error updating solution webview:', error);
            this._view.webview.postMessage({
                command: 'error',
                message: 'Failed to load solution data'
            });
        }
    }

    private async _getSolutionData(): Promise<any[]> {
        console.log('[SolutionWebviewProvider] Getting solution data...');

        // Find solution file using the static method
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        console.log('[SolutionWebviewProvider] Workspace root:', workspaceRoot);

        const solutionPath = await SolutionService.findSolutionFile(workspaceRoot);
        console.log('[SolutionWebviewProvider] Found solution file:', solutionPath);

        if (!solutionPath) {
            console.log('[SolutionWebviewProvider] No solution file found');
            return [];
        }

        // Parse solution file using the static method
        const solutionData = await SolutionService.parseSolutionFile(solutionPath);
        console.log('[SolutionWebviewProvider] Parsed solution data:', solutionData);

        if (!solutionData) {
            console.log('[SolutionWebviewProvider] Failed to parse solution data');
            return [];
        }

        // Convert solution data to tree structure for the React component
        return await this._convertToTreeStructure(solutionData, solutionPath);
    }

    private async _convertToTreeStructure(solutionData: any, solutionPath: string): Promise<any[]> {
        const result: any[] = [];

        // Parse the solution file to get proper hierarchy
        console.log(`[SolutionWebviewProvider] Parsing solution file for hierarchy: ${solutionPath}`);
        const solutionFileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(solutionPath));
        const solutionFile = await SolutionFileParser.parse(solutionFileContent.toString(), path.dirname(solutionPath));
        const hierarchy = SolutionFileParser.buildProjectHierarchy(solutionFile);

        console.log(`[SolutionWebviewProvider] Built project hierarchy with ${hierarchy.size} levels`);

        // Add the solution as the root node
        const solutionNode: any = {
            type: 'solution',
            name: path.basename(solutionPath, '.sln'),
            path: solutionPath,
            children: []
        };

        // Get root level projects and solution folders from hierarchy
        const rootProjects = hierarchy.get('ROOT') || [];
        console.log(`[SolutionWebviewProvider] Found ${rootProjects.length} root-level items`);

        // Build tree recursively using hierarchy
        solutionNode.children = await this._buildHierarchicalNodes(rootProjects, hierarchy, solutionPath);

        // Sort solution-level items (projects and solution folders)
        solutionNode.children.sort((a: any, b: any) => {
            // Visual Studio ordering at solution level: Solution Folders -> Projects
            const getTypePriority = (item: any) => {
                if (item.type === 'solutionFolder') return 0;  // Solution folders first
                return 1;  // Projects second
            };

            const priorityA = getTypePriority(a);
            const priorityB = getTypePriority(b);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Within same type, sort alphabetically
            return a.name.localeCompare(b.name);
        });

        result.push(solutionNode);
        return result;
    }

    private async _buildHierarchicalNodes(projects: SolutionProject[], hierarchy: Map<string, SolutionProject[]>, solutionPath: string): Promise<any[]> {
        const nodes: any[] = [];

        for (const project of projects) {
            // Determine the item type based on typeGuid
            const itemType = this._getItemType(project.typeGuid);
            console.log(`[SolutionWebviewProvider] Processing ${itemType}: ${project.name}, type GUID: ${project.typeGuid}`);

            // Ensure path is absolute (for both projects and solution items)
            const absolutePath = this._resolveAbsolutePath(project.path || '', solutionPath);
            console.log(`[SolutionWebviewProvider] Path resolution: ${project.path} -> ${absolutePath}`);

            const itemNode: any = {
                type: itemType,
                name: project.name || path.basename(project.path || '', path.extname(project.path || '')),
                path: absolutePath,
                children: [],
                // Add framework information if available
                frameworks: project.targetFrameworks || [],
                // Store original typeGuid for debugging
                typeGuid: project.typeGuid,
                // Store GUID for hierarchy lookup
                guid: project.guid
            };

            // Handle solution folders - add their children recursively
            if (itemType === 'solutionFolder') {
                const childProjects = hierarchy.get(project.guid) || [];
                console.log(`[SolutionWebviewProvider] Solution folder ${project.name} has ${childProjects.length} children`);

                // Always initialize children array for solution folders
                itemNode.children = [];

                if (childProjects.length > 0) {
                    itemNode.children = await this._buildHierarchicalNodes(childProjects, hierarchy, solutionPath);
                }

                // Add solution items (files directly in the solution folder)
                const solutionItems = SolutionFileParser.getSolutionItems(project);
                console.log(`[SolutionWebviewProvider] Solution folder ${project.name} has ${solutionItems.length} solution items`);

                for (const itemPath of solutionItems) {
                    itemNode.children.push({
                        type: 'file',
                        name: path.basename(itemPath),
                        path: path.resolve(path.dirname(solutionPath), itemPath)
                    });
                }

                // Sort solution folder children (solution folders first, then projects, then files)
                if (itemNode.children && itemNode.children.length > 0) {
                    itemNode.children.sort((a: any, b: any) => {
                        const getTypePriority = (item: any) => {
                            if (item.type === 'solutionFolder') return 0;  // Solution folders first
                            if (item.type === 'project') return 1;         // Projects second
                            if (item.type === 'file') return 2;            // Files third
                            return 3;  // Other types last
                        };

                        const priorityA = getTypePriority(a);
                        const priorityB = getTypePriority(b);

                        if (priorityA !== priorityB) {
                            return priorityA - priorityB;
                        }

                        return a.name.localeCompare(b.name);
                    });
                }
            }
            // Handle actual projects - load project files and dependencies
            else if (itemType === 'project') {
                try {
                    if (path.extname(absolutePath) === '.csproj' && await this._fileExists(absolutePath)) {
                        console.log(`[SolutionWebviewProvider] Loading project files from: ${absolutePath}`);

                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                        const parser = new ProjectFileParser(workspaceRoot);
                        const projectData = await parser.parseProjectFiles(absolutePath);
                        console.log(`[SolutionWebviewProvider] Project data loaded:`, {
                            files: projectData.files?.length || 0,
                            dependencies: projectData.dependencies?.length || 0
                        });

                        // Add source files if available
                        if (projectData.files && projectData.files.length > 0) {
                            console.log(`[SolutionWebviewProvider] Adding ${projectData.files.length} source files for project ${project.name}`);

                            // Filter to only source files (not directories)
                            const sourceFiles = projectData.files
                                .filter(file => !file.isDirectory)
                                .map(file => file.path);

                            if (sourceFiles.length > 0) {
                                console.log(`[SolutionWebviewProvider] Organizing ${sourceFiles.length} source files into directory structure`);

                                // First organize files by directory structure
                                const fileTree = this._buildDirectoryStructure(sourceFiles, path.dirname(absolutePath));

                                // Convert directory tree to nodes
                                const fileNodes = this._convertDirectoryTreeToNodes(fileTree);
                                itemNode.children.push(...fileNodes);
                            }
                        }

                        // Store dependencies for later use
                        if (projectData.dependencies && projectData.dependencies.length > 0) {
                            console.log(`[SolutionWebviewProvider] Found dependencies from project file: ${projectData.dependencies.length}`);
                            // Store dependencies in the item node for later use
                            (itemNode as any).projectDependencies = projectData.dependencies;
                        }
                    } else {
                        console.log(`[SolutionWebviewProvider] Skipping project file loading for ${project.name} (not a .csproj or file doesn't exist)`);
                    }
                } catch (error) {
                    console.error(`[SolutionWebviewProvider] Error loading project files for ${project.name}:`, error);
                }

                // Add dependencies node (only for projects)
                if ((itemNode as any).projectDependencies && (itemNode as any).projectDependencies.length > 0) {
                    const depsNode = {
                        type: 'dependencies',
                        name: 'Dependencies',
                        path: `${absolutePath}/dependencies`,
                        children: (itemNode as any).projectDependencies.slice(0, 20).map((dep: any) => ({
                            type: 'dependency',
                            name: `${dep.name}${dep.version ? ` (${dep.version})` : ''}`,
                            path: `${absolutePath}/dependencies/${dep.name}`
                        }))
                    };
                    itemNode.children.push(depsNode);
                }

                // Sort project children using Visual Studio ordering
                itemNode.children.sort((a: any, b: any) => {
                    // Visual Studio ordering: Dependencies -> Folders -> Files
                    const getTypePriority = (item: any) => {
                        if (item.name === 'Dependencies') return 0;  // Dependencies always first
                        if (item.type === 'folder') return 1;  // Regular folders
                        return 2;  // Files
                    };

                    const priorityA = getTypePriority(a);
                    const priorityB = getTypePriority(b);

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }

                    // Within same type, sort alphabetically
                    return a.name.localeCompare(b.name);
                });
            }

            nodes.push(itemNode);
        }

        return nodes;
    }

    private _convertFilesToNodes(nestedFiles: any[]): any[] {
        return nestedFiles.map(file => ({
            type: 'file',
            name: file.name,
            path: file.path,
            children: file.children ? this._convertFilesToNodes(file.children) : undefined
        }));
    }

    private async _fileExists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            return false;
        }
    }

    private _getItemType(typeGuid: string): string {
        // Project type GUIDs from VS solution files
        const PROJECT_TYPE_GUIDS = {
            SOLUTION_FOLDER: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
            CSHARP_PROJECT: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
            VB_PROJECT: '{F184B08F-C81C-45F6-A57F-5ABD9991F28F}',
            FSHARP_PROJECT: '{F2A71F9B-5D33-465A-A702-920D77279786}',
            CPP_PROJECT: '{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}',
            WEB_PROJECT: '{E24C65DC-7377-472B-9ABA-BC803B73C61A}',
            DATABASE_PROJECT: '{00D1A9C2-B5F0-4AF3-8072-F6C62B433612}'
        };

        switch (typeGuid.toUpperCase()) {
            case PROJECT_TYPE_GUIDS.SOLUTION_FOLDER:
                return 'solutionFolder';
            case PROJECT_TYPE_GUIDS.CSHARP_PROJECT:
            case PROJECT_TYPE_GUIDS.VB_PROJECT:
            case PROJECT_TYPE_GUIDS.FSHARP_PROJECT:
            case PROJECT_TYPE_GUIDS.CPP_PROJECT:
            case PROJECT_TYPE_GUIDS.WEB_PROJECT:
            case PROJECT_TYPE_GUIDS.DATABASE_PROJECT:
                return 'project';
            default:
                console.warn(`[SolutionWebviewProvider] Unknown project type GUID: ${typeGuid}, defaulting to 'project'`);
                return 'project';
        }
    }

    private _resolveAbsolutePath(itemPath: string, solutionPath: string): string {
        if (!itemPath) {
            return '';
        }

        if (path.isAbsolute(itemPath)) {
            return itemPath;
        }

        // For solution folders, the path is usually just the folder name
        // For projects, it's a relative path to the .csproj file
        return path.resolve(path.dirname(solutionPath), itemPath);
    }

    private _buildDirectoryStructure(filePaths: string[], projectRoot: string): DirectoryNode {
        console.log(`[SolutionWebviewProvider] Building directory structure for project root: ${projectRoot}`);

        const root: DirectoryNode = {
            name: '',
            path: projectRoot,
            type: 'directory',
            children: new Map(),
            files: []
        };

        for (const filePath of filePaths) {
            // Get relative path from project root
            const relativePath = path.relative(projectRoot, filePath);
            console.log(`[SolutionWebviewProvider] Processing file: ${filePath} -> ${relativePath}`);

            // Skip files outside project directory
            if (relativePath.startsWith('..')) {
                console.log(`[SolutionWebviewProvider] Skipping file outside project: ${filePath}`);
                continue;
            }

            // Split the path into directory segments
            const segments = relativePath.split(path.sep);
            const fileName = segments.pop()!;

            // Navigate to the correct directory, creating folders as needed
            let currentDir = root;
            for (const segment of segments) {
                if (!currentDir.children.has(segment)) {
                    const dirPath = path.join(currentDir.path, segment);
                    currentDir.children.set(segment, {
                        name: segment,
                        path: dirPath,
                        type: 'directory',
                        children: new Map(),
                        files: []
                    });
                }
                currentDir = currentDir.children.get(segment)!;
            }

            // Add the file to the directory
            currentDir.files.push({
                name: fileName,
                path: filePath,
                type: 'file'
            });
        }

        return root;
    }

    private _convertDirectoryTreeToNodes(dirNode: DirectoryNode): any[] {
        const result: any[] = [];

        // First add all subdirectories
        for (const [, childDir] of dirNode.children) {
            const folderNode = {
                type: 'folder',
                name: childDir.name,
                path: childDir.path,
                children: this._convertDirectoryTreeToNodes(childDir)
            };
            result.push(folderNode);
        }

        // Then add files in this directory, applying file nesting
        if (dirNode.files.length > 0) {
            console.log(`[SolutionWebviewProvider] Applying file nesting to ${dirNode.files.length} files in ${dirNode.path}`);

            // Apply file nesting within this directory
            const nestedFiles = FileNestingService.nestFiles(dirNode.files);
            const fileNodes = this._convertFilesToNodes(nestedFiles);
            result.push(...fileNodes);
        }

        return result.sort((a, b) => {
            // Visual Studio ordering: Dependencies -> Solution Folders -> Regular Folders -> Files
            const getTypePriority = (item: any) => {
                if (item.name === 'Dependencies') return 0;  // Dependencies always first
                if (item.isSolutionFolder || (item.type === 'folder' && item.name === 'Solution Items')) return 1;  // Solution folders
                if (item.type === 'folder') return 2;  // Regular filesystem folders
                return 3;  // Files
            };

            const priorityA = getTypePriority(a);
            const priorityB = getTypePriority(b);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Within same type, sort alphabetically
            return a.name.localeCompare(b.name);
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri, 'out', 'webview', 'solution-view', 'bundle.js'
        ));

        // Add Codicons CSS for proper VS Code icons
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri, 'out', 'webview', 'codicons', 'codicon.css'
        ));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';">
                <title>Solution Explorer</title>
                <link rel="stylesheet" type="text/css" href="${codiconsCss}">
                <style>

                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                        padding: 8px;
                    }

                    .solution-explorer {
                        display: flex;
                        flex-direction: column;
                        height: 100%;
                    }

                    .solution-tree {
                        outline: none;
                    }

                    .solution-tree:focus,
                    .solution-tree:focus-visible {
                        outline: none;
                        border: none;
                    }

                    .header {
                        margin-bottom: 8px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }

                    .framework-selector {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }

                    .framework-selector label {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .framework-selector select {
                        background-color: var(--vscode-dropdown-background);
                        border: 1px solid var(--vscode-dropdown-border);
                        color: var(--vscode-dropdown-foreground);
                        padding: 4px 8px;
                        font-size: 11px;
                    }

                    .content {
                        flex: 1;
                        overflow-y: auto;
                    }

                    .tree-node {
                        display: flex;
                        align-items: center;
                        padding: 2px 4px;
                        cursor: pointer;
                        user-select: none;
                        white-space: nowrap;
                    }

                    .tree-node:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }

                    .tree-node.selected {
                        background-color: var(--vscode-list-inactiveSelectionBackground);
                        color: var(--vscode-list-inactiveSelectionForeground);
                    }

                    .tree-node.focused {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    .tree-node.focused.selected {
                        background-color: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }

                    .node-icon {
                        margin-right: 6px;
                        font-size: 16px;
                        width: 16px;
                        height: 16px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }

                    .node-name {
                        font-size: 12px;
                    }

                    .expand-icon {
                        margin-right: 4px;
                        font-size: 12px;
                        width: 12px;
                        height: 12px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                    }

                    .expand-icon-placeholder {
                        margin-right: 4px;
                        width: 12px;
                        height: 12px;
                        display: inline-block;
                    }

                    .context-menu {
                        background-color: var(--vscode-menu-background);
                        border: 1px solid var(--vscode-menu-border);
                        border-radius: 6px;
                        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                        padding: 4px 0;
                        min-width: 220px;
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                        line-height: 1.4;
                    }

                    .context-menu-content {
                        display: flex;
                        flex-direction: column;
                    }

                    .context-menu-item {
                        display: flex;
                        align-items: center;
                        padding: 4px 32px;
                        margin: 0 4px;
                        cursor: pointer;
                        color: var(--vscode-menu-foreground);
                        transition: background-color 0.1s ease;
                        position: relative;
                        min-height: 18px;
                        border-radius: 4px;
                    }

                    .context-menu-item:hover {
                        background-color: var(--vscode-menu-selectionBackground);
                        color: var(--vscode-menu-selectionForeground);
                    }

                    .context-menu-item:active {
                        background-color: var(--vscode-menu-selectionBackground);
                    }

                    .context-menu-item.focused {
                        background-color: var(--vscode-menu-selectionBackground);
                        color: var(--vscode-menu-selectionForeground);
                    }

                    .context-menu-icon {
                        margin-right: 12px;
                        width: 16px;
                        height: 16px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0.9;
                    }

                    .context-menu-label {
                        flex: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        font-weight: 400;
                    }

                    .context-menu-shortcut {
                        margin-left: 24px;
                        color: var(--vscode-menu-foreground);
                        font-size: 12px;
                        opacity: 1;
                        font-weight: 400;
                    }

                    .context-menu-separator {
                        height: 1px;
                        background-color: var(--vscode-menu-separatorBackground);
                        margin: 4px 0px;
                    }

                    .rename-input {
                        background-color: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: 12px;
                        padding: 2px 4px;
                        outline: none;
                        border-radius: 2px;
                    }

                    .rename-input:focus {
                        border-color: var(--vscode-focusBorder);
                    }

                    .loading {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        padding: 20px;
                    }

                    .error {
                        text-align: center;
                        color: var(--vscode-errorForeground);
                        padding: 20px;
                    }
                </style>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public refresh() {
        // Don't refresh if we're in the middle of a rename operation
        if (this._isRenaming) {
            console.log('[SolutionWebviewProvider] Skipping refresh during rename operation');
            return;
        }
        this._updateWebview();
    }
}