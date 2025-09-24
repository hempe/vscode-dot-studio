import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { SolutionProvider } from '../../services/solutionProvider';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { SolutionFile, SolutionFileParser, SolutionProject } from '../../parsers/solutionFileParser';
import { NodeType, ProjectActionType, ProjectNode, SolutionData } from '../solution-view/types';
import { Solution } from '../../core/Solution';
import { ProjectFileNode } from '../../core/Project';

interface FileChangeEvent {
    filePath: string;
    changeType: 'created' | 'changed' | 'deleted';
    timestamp: number;
}

interface WebviewMessage {
    command: string;
    framework?: string;
    action?: ProjectActionType;
    projectPath?: string;
    data?: MessageData;
    expandedNodes?: string[];
    nodePath?: string;
    nodeType?: string;
}

interface MessageData {
    type?: string;
    oldName?: string;
    newName?: string;
    name?: string;
}

export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;
    private _currentSolutionPath?: string;
    private _isInitialized: boolean = false;
    private _fileChangeQueue: FileChangeEvent[] = [];
    private _isProcessingQueue: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _solutionService: SolutionService,
        private readonly _solutionProvider: SolutionProvider | undefined, // Legacy - not used anymore
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

        // Send initial data when webview is ready (only if not already initialized)
        if (!this._isInitialized) {
            console.log('[SolutionWebviewProvider] First time initialization');
            this._updateWebview();
            this._isInitialized = true;
        } else {
            console.log('[SolutionWebviewProvider] Webview reconnected, sending current data');
            // Just send current data without full reload if we're already initialized
            this._sendCurrentData();
        }
    }

    private async _handleMessage(message: WebviewMessage) {
        console.log('[SolutionWebviewProvider] Received message:', message);

        switch (message.command) {
            case 'getSolutionData':
                console.log('[SolutionWebviewProvider] Handling getSolutionData request');
                await this._sendCurrentData();
                break;

            case 'setFramework':
                console.log('[SolutionWebviewProvider] Handling setFramework request:', message.framework);
                await this._frameworkService.setActiveFramework(message.framework);
                break;

            case 'projectAction':
                if (message.action && message.projectPath) {
                    console.log('[SolutionWebviewProvider] Handling projectAction:', {
                        action: message.action,
                        projectPath: message.projectPath,
                        data: message.data
                    });
                    await this._handleProjectAction(message.action, message.projectPath, message.data);
                }
                break;

            case 'openFile':
                console.log('[SolutionWebviewProvider] Handling direct openFile request:', message.projectPath);
                if (message.projectPath) {
                    const uri = vscode.Uri.file(message.projectPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;

            case 'saveExpansionState':
                if (message.expandedNodes) {
                    console.log('[SolutionWebviewProvider] Handling saveExpansionState request:', message.expandedNodes);
                    this.saveExpansionState(message.expandedNodes);
                }
                break;

            case 'expandNode':
                if (message.nodePath && message.nodeType) {
                    console.log('[SolutionWebviewProvider] Handling expandNode request:', message.nodePath, message.nodeType);
                    await this._handleExpandNode(message.nodePath, message.nodeType);
                }
                break;

            case 'collapseNode':
                if (message.nodePath) {
                    console.log('[SolutionWebviewProvider] Handling collapseNode request:', message.nodePath);
                    await this._handleCollapseNode(message.nodePath);
                }
                break;

            default:
                console.log('[SolutionWebviewProvider] Unknown message command:', message.command);
        }
    }

    private async _handleProjectAction(action: ProjectActionType, projectPath: string, data?: MessageData) {
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
                if (data?.newName && data?.oldName && data?.type) {
                    console.log(`[SolutionWebviewProvider] Renaming ${data.oldName} to ${data.newName} at ${projectPath}`);
                    await this._handleRename(projectPath, data.newName, data.oldName, data.type as NodeType);
                }
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

            case 'addExistingProject':
                console.log(`[SolutionWebviewProvider] Adding existing project to solution: ${projectPath}`);
                await this._handleAddExistingProject(projectPath);
                break;

            case 'addNewProject':
                console.log(`[SolutionWebviewProvider] Adding new project to solution: ${projectPath}`);
                await this._handleAddNewProject(projectPath);
                break;

            case 'removeProject':
                console.log(`[SolutionWebviewProvider] Removing project from solution: ${projectPath}`);
                await this._handleRemoveProject(projectPath);
                break;

            case 'deleteProject':
                console.log(`[SolutionWebviewProvider] Deleting project: ${projectPath}`);
                await this._handleDeleteProject(projectPath);
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
            const fileExtension = path.extname(filePath).toLowerCase();

            // Check if it's a truly binary file that can't be handled by VS Code
            const binaryExtensions = [
                '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz',
                '.exe', '.dll', '.so', '.dylib',
                '.mp3', '.mp4', '.avi', '.wav', '.mov',
                '.docx', '.xlsx', '.pptx'
            ];

            if (binaryExtensions.includes(fileExtension)) {
                // For binary files, use the default system application
                await vscode.env.openExternal(uri);
                console.log(`[SolutionWebviewProvider] Opened binary file externally: ${filePath}`);
            } else {
                // Use vscode.open command which automatically chooses the appropriate viewer (text editor, image preview, etc.)
                await vscode.commands.executeCommand('vscode.open', uri);
                console.log(`[SolutionWebviewProvider] Opened file in VS Code: ${filePath}`);
            }
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

    private async _handleAddExistingProject(solutionPath: string) {
        try {
            console.log(`[SolutionWebviewProvider] Opening file dialog to select project file`);

            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'Project Files': ['csproj', 'vbproj', 'fsproj'],
                    'All Files': ['*']
                },
                openLabel: 'Add Project',
                title: 'Select Project to Add to Solution'
            };

            const fileUri = await vscode.window.showOpenDialog(options);

            if (fileUri && fileUri[0]) {
                const projectPath = fileUri[0].fsPath;
                console.log(`[SolutionWebviewProvider] Selected project: ${projectPath}`);

                // Add the project to the solution file
                await this._addProjectToSolution(solutionPath, projectPath);

                vscode.window.showInformationMessage(`Added project ${path.basename(projectPath)} to solution`);
                await this._sendCurrentData();
            } else {
                console.log(`[SolutionWebviewProvider] User cancelled project selection`);
            }
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error adding existing project:`, error);
            vscode.window.showErrorMessage(`Error adding project to solution: ${error}`);
        }
    }

    private async _addProjectToSolution(solutionPath: string, projectPath: string): Promise<void> {
        // This is a simplified implementation - in a real scenario, you'd need to:
        // 1. Parse the solution file
        // 2. Add the project entry with a new GUID
        // 3. Add it to the project configuration section
        // 4. Save the solution file

        // For now, we'll use the dotnet CLI command to add the project
        const relativePath = path.relative(path.dirname(solutionPath), projectPath);
        const command = `dotnet sln "${solutionPath}" add "${relativePath}"`;

        console.log(`[SolutionWebviewProvider] Executing: ${command}`);

        const { exec } = require('child_process');
        const solutionDir = path.dirname(solutionPath);

        await new Promise<void>((resolve, reject) => {
            exec(command, { cwd: solutionDir }, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    console.error(`[SolutionWebviewProvider] Error adding project to solution:`, error);
                    console.error(`[SolutionWebviewProvider] Command: ${command}`);
                    console.error(`[SolutionWebviewProvider] Working directory: ${solutionDir}`);
                    console.error(`[SolutionWebviewProvider] Relative path: ${relativePath}`);
                    reject(error);
                } else {
                    console.log(`[SolutionWebviewProvider] Successfully added project to solution:`, stdout);
                    resolve();
                }
            });
        });

        await this._sendCurrentData();
    }

    private async _handleAddNewProject(solutionPath: string) {
        try {
            console.log(`[SolutionWebviewProvider] Creating new project for solution: ${solutionPath}`);

            // Define common project templates
            const projectTemplates = [
                { label: 'Console Application', detail: 'A command-line application', template: 'console' },
                { label: 'Class Library', detail: 'A reusable library of classes', template: 'classlib' },
                { label: 'ASP.NET Core Web Application', detail: 'A web application using ASP.NET Core', template: 'webapp' },
                { label: 'ASP.NET Core Web API', detail: 'A RESTful web API using ASP.NET Core', template: 'webapi' },
                { label: 'Blazor Server App', detail: 'A Blazor server-side application', template: 'blazorserver' },
                { label: 'Blazor WebAssembly App', detail: 'A Blazor client-side application', template: 'blazorwasm' },
                { label: 'xUnit Test Project', detail: 'A unit test project using xUnit', template: 'xunit' },
                { label: 'NUnit Test Project', detail: 'A unit test project using NUnit', template: 'nunit' },
                { label: 'MSTest Test Project', detail: 'A unit test project using MSTest', template: 'mstest' }
            ];

            // Show QuickPick for template selection
            const selectedTemplate = await vscode.window.showQuickPick(projectTemplates, {
                placeHolder: 'Select project template',
                title: 'New Project Template'
            });

            if (!selectedTemplate) {
                console.log(`[SolutionWebviewProvider] User cancelled template selection`);
                return;
            }

            // Ask for project name
            const projectName = await vscode.window.showInputBox({
                prompt: 'Enter project name',
                placeHolder: 'MyProject',
                title: 'New Project Name',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Project name cannot be empty';
                    }
                    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(value.trim())) {
                        return 'Project name must start with a letter and contain only letters, numbers, dots, and underscores';
                    }
                    return null;
                }
            });

            if (!projectName) {
                console.log(`[SolutionWebviewProvider] User cancelled project name input`);
                return;
            }

            console.log(`[SolutionWebviewProvider] Creating project: ${projectName} with template: ${selectedTemplate.template}`);

            // Create the project
            await this._createNewProject(solutionPath, projectName.trim(), selectedTemplate.template);

            vscode.window.showInformationMessage(`Created project ${projectName} and added to solution`);

        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error creating new project:`, error);
            vscode.window.showErrorMessage(`Error creating new project: ${error}`);
        }
    }

    private async _createNewProject(solutionPath: string, projectName: string, template: string): Promise<void> {
        const solutionDir = path.dirname(solutionPath);
        const projectPath = path.join(solutionDir, projectName);

        // Use dotnet CLI to create the project
        const createCommand = `dotnet new ${template} -n "${projectName}" -o "${projectPath}"`;
        console.log(`[SolutionWebviewProvider] Executing: ${createCommand}`);

        const { exec } = require('child_process');

        // Create the project
        await new Promise<void>((resolve, reject) => {
            exec(createCommand, { cwd: solutionDir }, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    console.error(`[SolutionWebviewProvider] Error creating project:`, error);
                    reject(error);
                } else {
                    console.log(`[SolutionWebviewProvider] Successfully created project:`, stdout);
                    resolve();
                }
            });
        });

        // Add the project to the solution
        const projectFile = path.join(projectPath, `${projectName}.csproj`);
        await this._addProjectToSolution(solutionPath, projectFile);
    }

    private async _handleRemoveProject(projectPath: string) {
        try {
            console.log(`[SolutionWebviewProvider] Removing project from solution: ${projectPath}`);

            // Use the current solution path
            if (!this._currentSolutionPath) {
                vscode.window.showErrorMessage('No solution file loaded');
                return;
            }

            // Confirm with user
            const answer = await vscode.window.showWarningMessage(
                `Remove project "${path.basename(projectPath)}" from solution?`,
                { modal: true },
                'Remove'
            );

            if (answer !== 'Remove') {
                console.log(`[SolutionWebviewProvider] User cancelled project removal`);
                return;
            }

            // Remove the project from solution using dotnet CLI
            // TODO: Move this to SolutionManager or Solution class
            const success = await this._removeProjectFromSolution(this._currentSolutionPath, projectPath);

            if (success) {
                vscode.window.showInformationMessage(`Removed project from solution`);
            } else {
                vscode.window.showErrorMessage(`Failed to remove project from solution`);
            }

        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error removing project:`, error);
            vscode.window.showErrorMessage(`Error removing project: ${error}`);
        }
    }

    private async _handleDeleteProject(projectPath: string) {
        try {
            console.log(`[SolutionWebviewProvider] Deleting project: ${projectPath}`);

            const projectName = path.basename(projectPath);
            const projectDir = path.dirname(projectPath);

            // Confirm with user - this is destructive
            const answer = await vscode.window.showWarningMessage(
                `Delete project "${projectName}" and all its files permanently?`,
                { modal: true },
                'Delete Permanently'
            );

            if (answer !== 'Delete Permanently') {
                console.log(`[SolutionWebviewProvider] User cancelled project deletion`);
                return;
            }

            // First remove from solution
            if (this._currentSolutionPath) {
                await this._removeProjectFromSolution(this._currentSolutionPath, projectPath);
            }

            // Then delete the project directory
            const fs = require('fs').promises;
            await fs.rmdir(projectDir, { recursive: true });

            vscode.window.showInformationMessage(`Deleted project "${projectName}"`);

        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error deleting project:`, error);
            vscode.window.showErrorMessage(`Error deleting project: ${error}`);
        }
    }

    private async _sendProjectAddedUpdate(solutionPath: string, projectName: string) {
        try {
            // Get fresh solution data to find the new project
            const solution = SolutionService.getActiveSolution();
            if (!solution || !solution.solutionFile) {
                console.warn('[SolutionWebviewProvider] No active solution for project added update');
                this._updateWebview(); // Fallback to full reload
                return;
            }

            const treeStructure = await this._convertToTreeStructureWithLazyLoading(solution);

            // Find the newly added project in the tree structure
            const findProject = (nodes: ProjectNode[]): ProjectNode | null => {
                for (const node of nodes) {
                    if (node.type === 'project' && node.name === projectName) {
                        return node;
                    }
                    if (node.children) {
                        const found = findProject(node.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            const newProject = findProject(treeStructure);
            if (newProject && this._view) {
                console.log(`[SolutionWebviewProvider] Sending projectAdded update for: ${projectName}`);
                this._view.webview.postMessage({
                    command: 'projectAdded',
                    project: newProject
                });
            } else {
                console.warn(`[SolutionWebviewProvider] Could not find new project ${projectName} in tree structure`);
                // Fallback to full reload if we can't find the project
                this._updateWebview();
            }
        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error sending project added update:`, error);
            // Fallback to full reload on error
            this._updateWebview();
        }
    }

    private async _handleExpandNode(nodePath: string, nodeType: string): Promise<void> {
        console.log(`[SolutionWebviewProvider] Expanding ${nodeType} node: ${nodePath}`);

        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                console.warn('[SolutionWebviewProvider] No active solution for expand operation');
                return;
            }

            console.log(`[SolutionWebviewProvider] Available solutions projects:`, Array.from(solution.projects.keys()));

            if (nodeType === 'project') {
                // Expanding a project - load its file tree using the new Project methods
                const project = solution.getProject(nodePath);
                if (project) {
                    console.log(`[SolutionWebviewProvider] Using Project.getRootChildren() for: ${project.name}`);
                    const rootChildren = await project.getRootChildren();

                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'nodeExpanded',
                            nodePath: nodePath,
                            children: this._convertProjectChildrenToProjectNodes(rootChildren)
                        });
                    }
                } else {
                    console.warn(`[SolutionWebviewProvider] Could not find project instance: ${nodePath}`);
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - get the project and load its dependencies
                const projectPath = nodePath.replace('/dependencies', ''); // Remove the '/dependencies' suffix
                const project = solution.getProject(projectPath);
                if (project) {
                    console.log(`[SolutionWebviewProvider] Using Project.getDependencies() for: ${projectPath}`);
                    const dependencies = project.getDependencies();

                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'nodeExpanded',
                            nodePath: nodePath,
                            children: this._convertProjectChildrenToProjectNodes(dependencies)
                        });
                    }
                } else {
                    console.warn(`[SolutionWebviewProvider] Could not find project instance for dependencies: ${projectPath}`);
                }
            } else if (nodeType === 'folder') {
                // Expanding a folder within a project using the new Project methods
                const projectPath = this._findProjectPathForFolder(nodePath);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        console.log(`[SolutionWebviewProvider] Using Project.getFolderChildren() for: ${nodePath}`);
                        const folderChildren = await project.getFolderChildren(nodePath);

                        if (this._view) {
                            this._view.webview.postMessage({
                                command: 'nodeExpanded',
                                nodePath: nodePath,
                                children: this._convertProjectChildrenToProjectNodes(folderChildren)
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[SolutionWebviewProvider] Error expanding node:', error);
        }
    }

    private async _handleCollapseNode(nodePath: string): Promise<void> {
        console.log(`[SolutionWebviewProvider] Collapsing node: ${nodePath}`);

        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                console.warn('[SolutionWebviewProvider] No active solution for collapse operation');
                return;
            }

            // Find the project that contains this path
            const projectPath = this._findProjectPathForFolder(nodePath);
            if (projectPath) {
                const project = solution.getProject(projectPath);
                if (project) {
                    project.collapseFolder(nodePath);

                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'nodeCollapsed',
                            nodePath: nodePath
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[SolutionWebviewProvider] Error collapsing node:', error);
        }
    }

    private _findProjectPathForFolder(folderPath: string): string | undefined {
        const solution = SolutionService.getActiveSolution();
        if (!solution) return undefined;

        // Check each project to see if this folder path is within it
        for (const project of solution.getDotNetProjects()) {
            const projectDir = path.dirname(project.projectPath);
            if (folderPath.startsWith(projectDir)) {
                return project.projectPath;
            }
        }

        return undefined;
    }

    private _convertProjectFileNodesToProjectNodes(fileNodes: ProjectFileNode[]): ProjectNode[] {
        return fileNodes.map(fileNode => ({
            type: fileNode.type === 'folder' ? 'folder' : 'file',
            name: fileNode.name,
            path: fileNode.path,
            children: fileNode.children ? this._convertProjectFileNodesToProjectNodes(fileNode.children) : undefined,
            isLoaded: fileNode.isLoaded,
            hasChildren: fileNode.type === 'folder' && !fileNode.isLoaded
        }));
    }

    /**
     * Converts Project class output format to ProjectNode format for the webview
     */
    private _convertProjectChildrenToProjectNodes(children: { type: 'dependencies' | 'dependency' | 'folder' | 'file', name: string, path: string, version?: string, dependencyType?: string }[]): ProjectNode[] {
        return children.map(child => {
            if (child.type === 'dependency') {
                return {
                    type: 'dependency' as NodeType,
                    name: child.name,
                    path: child.path,
                    version: child.version,
                    dependencyType: child.dependencyType
                };
            } else if (child.type === 'dependencies') {
                return {
                    type: 'dependencies' as NodeType,
                    name: child.name,
                    path: child.path,
                    hasChildren: true, // Dependencies node has children
                    isLoaded: false // Not loaded initially for lazy loading
                };
            } else {
                return {
                    type: child.type as NodeType,
                    name: child.name,
                    path: child.path,
                    hasChildren: child.type === 'folder', // Folders might have children
                    isLoaded: false // Not loaded initially for lazy loading
                };
            }
        });
    }

    /**
     * Helper method to remove project from solution using dotnet CLI
     * TODO: Move this to SolutionManager class
     */
    private async _removeProjectFromSolution(solutionPath: string, projectPath: string): Promise<boolean> {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            await execAsync(`dotnet sln "${solutionPath}" remove "${projectPath}"`);
            return true;
        } catch (error) {
            console.error('Error removing project from solution:', error);
            return false;
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
            const data: SolutionData = {
                projects: solutionData,
                frameworks: frameworks || [],
                activeFramework,
                expandedNodes: this.getExpansionState()
            }


            this._view.webview.postMessage({
                command: 'solutionData',
                data
            });
        } catch (error) {
            console.error('[SolutionWebviewProvider] Error updating solution webview:', error);
            this._view.webview.postMessage({
                command: 'error',
                message: 'Failed to load solution data'
            });
        }
    }

    private async _getSolutionData(): Promise<ProjectNode[]> {
        console.log('[SolutionWebviewProvider] Getting solution data...');

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        console.log('[SolutionWebviewProvider] Workspace root:', workspaceRoot);

        // Use the new solution discovery and initialization
        const solution = await SolutionService.discoverAndInitializeSolution(workspaceRoot);
        if (!solution) {
            console.log('[SolutionWebviewProvider] No solution found or failed to initialize');
            return [];
        }

        // Store the current solution path for later use
        this._currentSolutionPath = solution.solutionPath;

        // Get solution file data
        const solutionData = solution.solutionFile;
        if (!solutionData) {
            console.log('[SolutionWebviewProvider] Failed to get solution data');
            return [];
        }

        console.log('[SolutionWebviewProvider] Got solution data:', solutionData);

        this._frameworkService.setSolution(solution.solutionPath, solutionData);

        // Convert solution data to tree structure for the React component
        const treeStructure = await this._convertToTreeStructureWithLazyLoading(solution);

        return treeStructure;
    }

    private async _convertToTreeStructureWithLazyLoading(solution: Solution): Promise<ProjectNode[]> {
        const result: ProjectNode[] = [];

        if (!solution.solutionFile) return result;

        // Get project hierarchy
        const hierarchy = solution.getProjectHierarchy();
        const solutionPath = solution.solutionPath;

        console.log(`[SolutionWebviewProvider] Building lazy-loaded tree structure for: ${solutionPath}`);

        // Add the solution as the root node
        const solutionNode: ProjectNode = {
            type: 'solution',
            name: path.basename(solutionPath, '.sln'),
            path: solutionPath,
            children: []
        };

        // Get root level projects and solution folders from hierarchy
        const rootProjects = hierarchy.get('ROOT') || [];
        console.log(`[SolutionWebviewProvider] Found ${rootProjects.length} root-level items`);

        // Build tree using lazy loading approach
        solutionNode.children = await this._buildLazyHierarchicalNodes(rootProjects, hierarchy, solution);

        // Sort solution-level items (projects and solution folders)
        solutionNode.children.sort((a: ProjectNode, b: ProjectNode) => {
            // Visual Studio ordering at solution level: Solution Folders -> Projects
            const getTypePriority = (item: ProjectNode) => {
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


    private async _buildLazyHierarchicalNodes(projects: SolutionProject[], hierarchy: Map<string, SolutionProject[]>, solution: Solution): Promise<ProjectNode[]> {
        const nodes: ProjectNode[] = [];

        for (const project of projects) {
            // Determine the item type based on typeGuid
            const itemType = this._getItemType(project.typeGuid);
            console.log(`[SolutionWebviewProvider] Processing ${itemType}: ${project.name}, type GUID: ${project.typeGuid}`);

            // Ensure path is absolute (for both projects and solution items)
            const absolutePath = this._resolveAbsolutePath(project.path || '', solution.solutionPath);
            console.log(`[SolutionWebviewProvider] Path resolution: ${project.path} -> ${absolutePath}`);

            const itemNode: ProjectNode = {
                type: itemType,
                name: project.name || path.basename(project.path || '', path.extname(project.path || '')),
                path: absolutePath,
                children: [],
                // Add framework information if available
                frameworks: project.targetFrameworks || [],
                // Store original typeGuid for debugging
                typeGuid: project.typeGuid,
                // Store GUID for hierarchy lookup
                guid: project.guid,
                // Mark as not loaded for lazy loading
                isLoaded: false
            };

            // Check if project nodes actually have children
            if (itemType === 'project') {
                try {
                    const projectInstance = solution.getProject(absolutePath);
                    if (projectInstance && projectInstance.isInitialized) {
                        const rootChildren = await projectInstance.getRootChildren();
                        itemNode.hasChildren = rootChildren.length > 0;
                        console.log(`[SolutionWebviewProvider] Project ${project.name} has ${rootChildren.length} root children, hasChildren: ${itemNode.hasChildren}`);
                    } else {
                        // If project not initialized yet, assume it has children
                        itemNode.hasChildren = true;
                        console.log(`[SolutionWebviewProvider] Project ${project.name} not initialized yet, assuming hasChildren: true`);
                    }
                } catch (error) {
                    console.warn(`[SolutionWebviewProvider] Error checking children for project ${project.name}:`, error);
                    // Fallback to assuming it has children
                    itemNode.hasChildren = true;
                }
            }

            // Handle solution folders - add their children recursively
            if (itemType === 'solutionFolder') {
                const childProjects = hierarchy.get(project.guid) || [];
                console.log(`[SolutionWebviewProvider] Solution folder ${project.name} has ${childProjects.length} children`);

                if (childProjects.length > 0) {
                    itemNode.children = await this._buildLazyHierarchicalNodes(childProjects, hierarchy, solution);
                }

                // Add solution items (files directly in the solution folder)
                const solutionItems = solution.getSolutionItems(project);
                console.log(`[SolutionWebviewProvider] Solution folder ${project.name} has ${solutionItems.length} solution items`);

                if (!itemNode.children) {
                    itemNode.children = [];
                }

                for (const itemPath of solutionItems) {
                    itemNode.children.push({
                        type: 'file',
                        name: path.basename(itemPath),
                        path: path.resolve(path.dirname(solution.solutionPath), itemPath)
                    });
                }

                // Sort solution folder children
                if (itemNode.children && itemNode.children.length > 0) {
                    itemNode.children.sort((a: ProjectNode, b: ProjectNode) => {
                        const getTypePriority = (item: ProjectNode) => {
                            if (item.type === 'solutionFolder') return 0;
                            if (item.type === 'project') return 1;
                            if (item.type === 'file') return 2;
                            return 3;
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
            // Handle actual projects - don't load files yet, just set up lazy loading
            else if (itemType === 'project') {
                const projectInstance = solution.getProject(absolutePath);
                if (projectInstance) {
                    // Use the new lazy loading approach - don't pre-load children
                    // Children will be loaded on demand when user expands the project
                    itemNode.hasChildren = true; // Projects can be expanded
                    itemNode.isLoaded = false; // Children not loaded yet
                } else {
                    console.warn(`[SolutionWebviewProvider] Could not find project instance for: ${absolutePath}`);
                    // If no project instance, mark as not expandable
                    itemNode.hasChildren = false;
                    itemNode.isLoaded = true;
                }
            }

            nodes.push(itemNode);
        }

        return nodes;
    }



    private _getItemType(typeGuid: string): NodeType {
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
                        outline: none;
                    }

                    .context-menu:focus {
                        outline: none;
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
        // Use incremental update instead of full refresh
        this._updateWebview();
    }

    private saveExpansionState(expandedNodes: string[]) {
        console.log('[SolutionWebviewProvider] Saving expansion state:', expandedNodes);
        this._context.workspaceState.update('solutionTreeExpanded', expandedNodes);
    }

    private getExpansionState(): string[] {
        const state = this._context.workspaceState.get('solutionTreeExpanded', []);
        console.log('[SolutionWebviewProvider] Retrieved expansion state:', state);
        return state;
    }

    private async _sendCurrentData() {
        console.log('[SolutionWebviewProvider] Sending current data to reconnected webview');

        if (!this._view) {
            console.log('[SolutionWebviewProvider] No webview available, skipping send');
            return;
        }

        try {
            console.log('[SolutionWebviewProvider] Rebuilding solution data for reconnection');
            const solutionData = await this._getSolutionData();

            const frameworks = await this._frameworkService.getAvailableFrameworks();

            const data: SolutionData = {
                projects: solutionData,
                frameworks: frameworks,
                activeFramework: this._frameworkService.getActiveFramework(),
                expandedNodes: this.getExpansionState()
            };

            console.log('[SolutionWebviewProvider] Sending solutionData to reconnected webview');
            this._view.webview.postMessage({
                command: 'solutionData',
                data: data
            });

        } catch (error) {
            console.error('[SolutionWebviewProvider] Error sending current data:', error);
            // Fallback to full update on error
            this._updateWebview();
        }
    }

    public async handleProjectAdded(projectPath: string) {
        console.log(`[SolutionWebviewProvider] Handling project added via file watcher: ${projectPath}`);

        if (!this._currentSolutionPath) {
            console.log('[SolutionWebviewProvider] No current solution path, doing full refresh');
            this._updateWebview();
            return;
        }

        const projectName = path.basename(projectPath, path.extname(projectPath));
        await this._sendProjectAddedUpdate(this._currentSolutionPath, projectName);
    }

    public handleProjectRemoved(projectPath: string) {
        console.log(`[SolutionWebviewProvider] Handling project removed via file watcher: ${projectPath}`);

        if (this._view) {
            this._view.webview.postMessage({
                command: 'projectRemoved',
                projectPath: projectPath
            });
        }
    }

    public handleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        console.log(`[SolutionWebviewProvider] Queueing file ${changeType}: ${filePath}`);

        // Check if we already have a event for this file to avoid duplicates
        const existingEventIndex = this._fileChangeQueue.findIndex(event =>
            event.filePath === filePath &&
            event.changeType === changeType
        );

        if (existingEventIndex >= 0) {
            console.log(`[SolutionWebviewProvider] Ignoring duplicate file change event for: ${filePath}`);
            return;
        }

        // Add to queue with timestamp
        this._fileChangeQueue.push({
            filePath,
            changeType,
            timestamp: Date.now()
        });

        // Process queue if not already processing
        this._processFileChangeQueue();
    }

    private async _processFileChangeQueue() {
        if (this._isProcessingQueue || this._fileChangeQueue.length === 0) {
            return;
        }

        this._isProcessingQueue = true;

        try {
            // Process all queued changes
            while (this._fileChangeQueue.length > 0) {
                const event = this._fileChangeQueue.shift()!;
                console.log(`[SolutionWebviewProvider] Processing queued file ${event.changeType}: ${event.filePath}`);

                // Add small delay between processing events to prevent race conditions
                await new Promise(resolve => setTimeout(resolve, 50));

                await this._handleSingleFileChange(event.filePath, event.changeType);
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    private async _handleSingleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        const fileName = path.basename(filePath);

        // Handle different types of file changes
        if (fileName.endsWith('.sln')) {
            // Solution file changed - do incremental update instead of full refresh
            console.log(`[SolutionWebviewProvider] Solution file ${changeType}, doing incremental update`);
            await this._handleSolutionFileChange(filePath, changeType);
        } else if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) {
            // Project file changes
            if (changeType === 'created') {
                console.log(`[SolutionWebviewProvider] Project file created: ${filePath}`);
                await this.handleProjectAdded(filePath);
            } else if (changeType === 'deleted') {
                console.log(`[SolutionWebviewProvider] Project file deleted: ${filePath}`);
                this.handleProjectRemoved(filePath);
            } else {
                // Project file content changed - do incremental update
                console.log(`[SolutionWebviewProvider] Project file content changed: ${fileName}`);
                await this._handleProjectFileChange(filePath);
            }
        } else {
            // All other files - add/remove from tree incrementally
            if (changeType === 'created') {
                await this._handleFileAdded(filePath);
            } else if (changeType === 'deleted') {
                await this._handleFileRemoved(filePath);
            } else {
                // File content changed - could show modification indicator in the future
                console.log(`[SolutionWebviewProvider] File content changed: ${fileName}`);
            }
        }
    }

    private async _handleFileAdded(filePath: string) {
        console.log(`[SolutionWebviewProvider] Adding file to tree: ${filePath}`);

        // Find which project this file belongs to
        const projectPath = await this._findProjectForFile(filePath);
        if (!projectPath) {
            console.log(`[SolutionWebviewProvider] Could not find project for file: ${filePath}`);
            return;
        }

        // Create file node data
        const fileNode = {
            type: 'file',
            name: path.basename(filePath),
            path: filePath
        };

        if (this._view) {
            this._view.webview.postMessage({
                command: 'fileAdded',
                file: fileNode,
                parentPath: projectPath
            });
        }
    }

    private _handleFileRemoved(filePath: string) {
        console.log(`[SolutionWebviewProvider] Removing file from tree: ${filePath}`);

        if (this._view) {
            this._view.webview.postMessage({
                command: 'fileRemoved',
                filePath: filePath
            });
        }
    }

    private async _findProjectForFile(filePath: string): Promise<string | undefined> {
        // Find the closest .csproj file by walking up the directory tree
        let currentDir = path.dirname(filePath);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        while (currentDir && currentDir !== workspaceRoot && currentDir !== path.dirname(currentDir)) {
            try {
                const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentDir));
                const projectFile = files.find(([name, type]) =>
                    type === vscode.FileType.File &&
                    (name.endsWith('.csproj') || name.endsWith('.vbproj') || name.endsWith('.fsproj'))
                );

                if (projectFile) {
                    return path.join(currentDir, projectFile[0]);
                }
            } catch (error) {
                console.warn(`[SolutionWebviewProvider] Error reading directory ${currentDir}:`, error);
            }

            currentDir = path.dirname(currentDir);
        }

        return undefined;
    }

    private async _handleSolutionFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        console.log(`[SolutionWebviewProvider] Handling solution file change: ${changeType} for ${filePath}`);

        if (changeType === 'deleted') {
            // Solution file was deleted - clear everything
            console.log(`[SolutionWebviewProvider] Solution file deleted, clearing tree`);
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'solutionDataUpdate',
                    projects: [],
                    frameworks: [],
                    expandedNodes: this.getExpansionState()
                });
            }
            return;
        }

        try {
            // Get the current solution data (should be automatically updated by Solution class file watcher)
            const solution = SolutionService.getActiveSolution();
            if (!solution || !solution.solutionFile) {
                console.warn('[SolutionWebviewProvider] No active solution after file change');
                return;
            }

            const newSolutionData = solution.solutionFile;
            console.log('[SolutionWebviewProvider] Got updated solution data:', newSolutionData);

            // Since the Solution class already handles change detection and notifications,
            // we just need to refresh the UI
            console.log('[SolutionWebviewProvider] Solution file changed, refreshing UI');
            await this._updateWebview();

        } catch (error) {
            console.error('[SolutionWebviewProvider] Error handling solution file change:', error);
            // Fallback to current cached state - don't reload
            console.log('[SolutionWebviewProvider] Keeping current state due to parse error');
        }
    }



    private async _handleProjectFileChange(projectPath: string) {
        console.log(`[SolutionWebviewProvider] Handling project file change: ${projectPath}`);

        try {
            // The Project class will handle this change automatically through its file watcher
            // We just need to refresh the affected project in the UI
            const projectName = path.basename(projectPath, path.extname(projectPath));
            await this._sendProjectRefreshUpdate(projectPath, projectName);

        } catch (error) {
            console.error(`[SolutionWebviewProvider] Error handling project file change:`, error);
        }
    }


    private async _sendProjectRefreshUpdate(projectPath: string, projectName: string) {
        console.log(`[SolutionWebviewProvider] Sending project refresh update for: ${projectName}`);

        if (!this._view) return;

        // Send targeted project update instead of full tree reload
        this._view.webview.postMessage({
            command: 'projectRefresh',
            projectPath: projectPath,
            projectName: projectName
        });
    }
}