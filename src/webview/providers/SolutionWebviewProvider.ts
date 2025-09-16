import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { FileNestingService } from '../../services/fileNesting';
import { ProjectFileParser } from '../../parsers/projectFileParser';

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

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _solutionService: SolutionService,
        private readonly _frameworkService: FrameworkDropdownService
    ) {}

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
                if (projectPath) {
                    try {
                        const uri = vscode.Uri.file(projectPath);
                        await vscode.window.showTextDocument(uri);
                        console.log(`[SolutionWebviewProvider] Successfully opened file: ${projectPath}`);
                    } catch (error) {
                        console.error(`[SolutionWebviewProvider] Failed to open file: ${projectPath}`, error);
                    }
                }
                break;

            case 'contextMenu':
                console.log(`[SolutionWebviewProvider] Context menu action for ${data?.type || 'unknown'} at ${projectPath}`);
                // Handle context menu actions based on data.type
                break;

            case 'build':
                console.log(`[SolutionWebviewProvider] Building project: ${projectPath}`);
                await vscode.commands.executeCommand('dotnet-extension.build', { path: projectPath });
                break;

            case 'rebuild':
                console.log(`[SolutionWebviewProvider] Rebuilding project: ${projectPath}`);
                await vscode.commands.executeCommand('dotnet-extension.rebuild', { path: projectPath });
                break;

            case 'clean':
                console.log(`[SolutionWebviewProvider] Cleaning project: ${projectPath}`);
                await vscode.commands.executeCommand('dotnet-extension.clean', { path: projectPath });
                break;

            default:
                console.warn(`[SolutionWebviewProvider] Unknown project action: ${action}`);
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

        // Add the solution as the root node
        const solutionNode: any = {
            type: 'solution',
            name: path.basename(solutionPath, '.sln'),
            path: solutionPath,
            children: []
        };

        // Add projects and solution folders
        if (solutionData.projects) {
            for (const project of solutionData.projects) {
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
                    typeGuid: project.typeGuid
                };

                // Load project files only for actual projects (not solution folders)
                if (itemType === 'project') {
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

                            // Use dependencies from project file if available
                            if (projectData.dependencies && projectData.dependencies.length > 0) {
                                console.log(`[SolutionWebviewProvider] Using dependencies from project file: ${projectData.dependencies.length}`);
                                project.dependencies = projectData.dependencies;
                            }
                        } else {
                            console.log(`[SolutionWebviewProvider] Skipping project file loading for ${project.name} (not a .csproj or file doesn't exist)`);
                        }
                    } catch (error) {
                        console.error(`[SolutionWebviewProvider] Error loading project files for ${project.name}:`, error);
                    }
                } else {
                    console.log(`[SolutionWebviewProvider] Item ${project.name} is a ${itemType}, not loading project files`);
                }

                // Add dependencies node (only for projects)
                if (itemType === 'project' && project.dependencies && project.dependencies.length > 0) {
                    const depsNode = {
                        type: 'folder',
                        name: 'Dependencies',
                        path: `${absolutePath}/dependencies`,
                        children: project.dependencies.slice(0, 20).map((dep: any) => ({
                            type: 'dependency',
                            name: `${dep.name}${dep.version ? ` (${dep.version})` : ''}`,
                            path: `${absolutePath}/dependencies/${dep.name}`
                        }))
                    };
                    itemNode.children.push(depsNode);
                }

                solutionNode.children.push(itemNode);
            }
        }

        result.push(solutionNode);
        return result;
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
                return 'folder';
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
            // Sort folders first, then files
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri, 'out', 'webview', 'solution-view', 'bundle.js'
        ));

        // Add Codicons font for proper VS Code icons
        const codiconsFont = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri, 'out', 'webview', 'codicons', 'codicon.ttf'
        ));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';">
                <title>Solution Explorer</title>
                <style>
                    /* Codicons font definition */
                    @font-face {
                        font-family: "codicon";
                        font-display: block;
                        src: url("${codiconsFont}") format("truetype");
                    }

                    .codicon[class*='codicon-'] {
                        font: normal normal normal 16px/1 codicon;
                        display: inline-block;
                        text-decoration: none;
                        text-rendering: auto;
                        text-align: center;
                        -webkit-font-smoothing: antialiased;
                        -moz-osx-font-smoothing: grayscale;
                        user-select: none;
                        -webkit-user-select: none;
                        -ms-user-select: none;
                    }

                    /* Codicon classes for our solution explorer */
                    .codicon-symbol-namespace:before { content: "\\ea8b"; }
                    .codicon-symbol-class:before { content: "\\eb5b"; }
                    .codicon-symbol-method:before { content: "\\ea8c"; }
                    .codicon-symbol-interface:before { content: "\\eb61"; }
                    .codicon-symbol-color:before { content: "\\eb5c"; }
                    .codicon-symbol-variable:before { content: "\\ea88"; }
                    .codicon-symbol-string:before { content: "\\eb8d"; }
                    .codicon-symbol-property:before { content: "\\eb65"; }
                    .codicon-references:before { content: "\\eb36"; }
                    .codicon-package:before { content: "\\eb29"; }
                    .codicon-folder:before { content: "\\ea83"; }
                    .codicon-folder-opened:before { content: "\\ea84"; }
                    .codicon-file:before { content: "\\ea7b"; }
                    .codicon-file-code:before { content: "\\eae9"; }
                    .codicon-file-directory:before { content: "\\ea83"; }
                    .codicon-file-text:before { content: "\\ea7b"; }
                    .codicon-json:before { content: "\\eb0f"; }
                    .codicon-markdown:before { content: "\\eb1d"; }
                    .codicon-database:before { content: "\\eace"; }
                    .codicon-gear:before { content: "\\eaf8"; }
                    .codicon-settings-gear:before { content: "\\eb51"; }
                    .codicon-globe:before { content: "\\eb01"; }
                    .codicon-vm:before { content: "\\ea7a"; }
                    .codicon-info:before { content: "\\ea74"; }
                    .codicon-question:before { content: "\\eb32"; }

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
        this._updateWebview();
    }
}