import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { SolutionTreeService } from '../../services/solutionTreeService';
import { SolutionActionService } from '../../services/solutionActionService';
import { SolutionExpansionService } from '../../services/solutionExpansionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { SolutionProject } from '../../parsers/solutionFileParser';
import { NodeType, ProjectActionType, ProjectNode, SolutionData } from '../solution-view/types';
import { Solution } from '../../core/Solution';
import { ProjectFileNode } from '../../core/Project';
import { logger } from '../../core/logger';
import { SolutionWebView } from './views/SolutionWebview';

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
    private readonly logger = logger('SolutionWebviewProvider');

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;
    private _currentSolutionPath?: string;
    private _isInitialized: boolean = false;
    private _fileChangeQueue: FileChangeEvent[] = [];
    private _isProcessingQueue: boolean = false;

    // Cache for solution tree data to improve expand performance
    private _cachedSolutionData?: ProjectNode[];
    private _cacheTimestamp?: number;
    private readonly _cacheTimeout = 30000; // 30 seconds cache

    // Protection against external state resets
    private _lastUpdateTimestamp?: number;
    private _rapidUpdateCount = 0;
    private _protectedExpansionState?: string[];
    private readonly _rapidUpdateThreshold = 3; // Max 3 updates in 2 seconds
    private readonly _rapidUpdateWindow = 2000; // 2 seconds

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
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

        webviewView.webview.html = SolutionWebView.getHtmlForWebview(this._extensionUri, webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            []
        );

        // Send initial data when webview is ready (only if not already initialized)
        if (!this._isInitialized) {
            this.logger.info('First time initialization');
            this._updateWebview();
            this._isInitialized = true;
        } else {
            this.logger.info('Webview reconnected, sending current data');
            // Just send current data without full reload if we're already initialized
            this._sendCurrentData();
        }
    }

    private async _handleMessage(message: WebviewMessage) {
        this.logger.info('Received message:', message);

        switch (message.command) {
            case 'getSolutionData':
                this.logger.info('Handling getSolutionData request');
                await this._sendCurrentData();
                break;

            case 'setFramework':
                this.logger.info('Handling setFramework request:', message.framework);
                await this._frameworkService.setActiveFramework(message.framework);
                break;

            case 'projectAction':
                if (message.action && message.projectPath) {
                    this.logger.info('Handling projectAction:', {
                        action: message.action,
                        projectPath: message.projectPath,
                        data: message.data
                    });
                    await SolutionActionService.handleProjectAction(message.action, message.projectPath, message.data);
                }
                break;

            case 'openFile':
                this.logger.info('Handling direct openFile request:', message.projectPath);
                if (message.projectPath) {
                    const uri = vscode.Uri.file(message.projectPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;

            case 'saveExpansionState':
                if (message.expandedNodes) {
                    this.logger.info('Handling saveExpansionState request:', message.expandedNodes);
                    SolutionExpansionService.saveExpansionState(message.expandedNodes, this._context);
                }
                break;

            case 'expandNode':
                if (message.nodePath && message.nodeType) {
                    this.logger.info('Handling expandNode request:', message.nodePath, message.nodeType);
                    await SolutionExpansionService.handleExpandNode(
                        message.nodePath,
                        message.nodeType,
                        this._cachedSolutionData || null,
                        () => this._updateWebview(),
                        this._context
                    );
                }
                break;

            case 'collapseNode':
                if (message.nodePath) {
                    this.logger.info('Handling collapseNode request:', message.nodePath);
                    await SolutionExpansionService.handleCollapseNode(
                        message.nodePath,
                        this._cachedSolutionData || null,
                        () => this._updateWebview(),
                        this._context
                    );
                }
                break;

            default:
                this.logger.info('Unknown message command:', message.command);
        }
    }

    private async _handleRename(oldPath: string, newName: string, oldName: string, nodeType: NodeType) {
        try {
            this.logger.info(`Attempting to rename ${nodeType} from "${oldName}" to "${newName}"`);

            // Set flag to prevent file watcher from triggering refresh
            this._isRenaming = true;

            if (nodeType === 'solutionFolder') {
                // Solution folders are virtual - rename in the .sln file, not filesystem
                await this._handleSolutionFolderRename(oldName, newName);
                return;
            }

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

            this.logger.info(`Renaming path: ${oldPath} -> ${newPath}`);

            // Use VS Code's workspace API to rename the file/folder
            const oldUri = vscode.Uri.file(oldPath);
            const newUri = vscode.Uri.file(newPath);

            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(oldUri, newUri);

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                this.logger.info(`Successfully renamed ${oldName} to ${newName}`);
                // Send a targeted update instead of full refresh to preserve tree state
                this._view?.webview.postMessage({
                    command: 'nodeRenamed',
                    oldPath: oldPath,
                    newPath: newPath,
                    newName: path.basename(finalNewName)
                });
            } else {
                this.logger.error(`Failed to rename ${oldName} to ${newName}`);
                vscode.window.showErrorMessage(`Failed to rename ${oldName} to ${newName}`);
            }
        } catch (error) {
            this.logger.error(`Error during rename:`, error);
            vscode.window.showErrorMessage(`Error renaming file: ${error}`);
        } finally {
            // Clear the flag and allow refreshes again after a short delay
            setTimeout(() => {
                this._isRenaming = false;
                this.logger.info('Rename operation completed, refreshes allowed again');
            }, 1000); // 1 second delay to allow file system events to settle
        }
    }

    private async _handleSolutionFolderRename(oldName: string, newName: string) {
        try {
            this.logger.info(`Renaming solution folder from "${oldName}" to "${newName}"`);

            // Get the active solution
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                throw new Error('No active solution loaded');
            }

            // Rename the solution folder - file watcher will handle UI updates
            await solution.renameSolutionFolder(oldName, newName);
            vscode.window.showInformationMessage(`Renamed solution folder "${oldName}" to "${newName}"`);

        } catch (error) {
            this.logger.error(`Error renaming solution folder:`, error);
            vscode.window.showErrorMessage(`Error renaming solution folder: ${error}`);
        }
    }

    private async _handleBuild(targetPath: string, action: 'build' | 'rebuild' | 'clean' | 'restore') {
        try {
            // Determine if this is a solution or project based on the file extension
            const isSolution = targetPath.endsWith('.sln');
            const isProject = targetPath.endsWith('.csproj') || targetPath.endsWith('.vbproj') || targetPath.endsWith('.fsproj');

            // Create terminal with appropriate title
            const targetType = isSolution ? 'Solution' : isProject ? 'Project' : 'Target';
            const targetName = path.basename(targetPath);
            const terminal = vscode.window.createTerminal(`${action} ${targetType}: ${targetName}`);
            terminal.show();

            let command: string;
            switch (action) {
                case 'build':
                    command = `dotnet build "${targetPath}"`;
                    break;
                case 'rebuild':
                    command = `dotnet clean "${targetPath}" && dotnet build "${targetPath}"`;
                    break;
                case 'clean':
                    command = `dotnet clean "${targetPath}"`;
                    break;
                case 'restore':
                    command = `dotnet restore "${targetPath}"`;
                    break;
            }

            terminal.sendText(command);
            this.logger.info(`Executed ${action} command for ${targetType}: ${command}`);
        } catch (error) {
            this.logger.error(`Error during ${action}:`, error);
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
                this.logger.info(`Opened binary file externally: ${filePath}`);
            } else {
                // Use vscode.open command which automatically chooses the appropriate viewer (text editor, image preview, etc.)
                await vscode.commands.executeCommand('vscode.open', uri);
                this.logger.info(`Opened file in VS Code: ${filePath}`);
            }
        } catch (error) {
            this.logger.error(`Error opening file:`, error);
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
                this.logger.info(`Deleted: ${itemPath}`);
                this._updateWebview(); // Refresh to show changes
            }
        } catch (error) {
            this.logger.error(`Error deleting item:`, error);
            vscode.window.showErrorMessage(`Error deleting item: ${error}`);
        }
    }

    private async _handleRevealInExplorer(itemPath: string) {
        try {
            const uri = vscode.Uri.file(itemPath);
            await vscode.commands.executeCommand('revealFileInOS', uri);
            this.logger.info(`Revealed in explorer: ${itemPath}`);
        } catch (error) {
            this.logger.error(`Error revealing in explorer:`, error);
            vscode.window.showErrorMessage(`Error revealing in explorer: ${error}`);
        }
    }

    private async _handleAddExistingProject(solutionPath: string) {
        try {
            this.logger.info(`Opening file dialog to select project file`);

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
                this.logger.info(`Selected project: ${projectPath}`);

                // Add the project to the solution file using the Solution class
                const solution = SolutionService.getActiveSolution();
                if (!solution) {
                    throw new Error('No active solution loaded');
                }

                await solution.addProject(projectPath);
                vscode.window.showInformationMessage(`Added project ${path.basename(projectPath)} to solution`);
            } else {
                this.logger.info(`User cancelled project selection`);
            }
        } catch (error) {
            this.logger.error(`Error adding existing project:`, error);
            vscode.window.showErrorMessage(`Error adding project to solution: ${error}`);
        }
    }

    private async _handleAddNewProject(targetPath: string) {
        try {
            this.logger.info(`Creating new project for target: ${targetPath}`);

            // Determine if this is a solution file or solution folder
            const isSolutionFile = targetPath.endsWith('.sln');
            let solutionPath: string;
            let targetSolutionFolderName: string | undefined;

            if (isSolutionFile) {
                solutionPath = targetPath;
                this.logger.info(`Adding project to solution root`);
            } else {
                // This is a solution folder - need to find the solution file
                const solution = SolutionService.getActiveSolution();
                if (!solution) {
                    throw new Error('No active solution loaded');
                }
                solutionPath = solution.solutionPath;
                targetSolutionFolderName = path.basename(targetPath);
                this.logger.info(`Adding project to solution folder: ${targetSolutionFolderName}`);
            }

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
                this.logger.info(`User cancelled template selection`);
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
                this.logger.info(`User cancelled project name input`);
                return;
            }

            this.logger.info(`Creating project: ${projectName} with template: ${selectedTemplate.template}`);

            // Create the project - file watcher will handle UI updates
            await this._createNewProject(solutionPath, projectName.trim(), selectedTemplate.template, targetSolutionFolderName);
            vscode.window.showInformationMessage(`Created project ${projectName} and added to solution`);

        } catch (error) {
            this.logger.error(`Error creating new project:`, error);
            vscode.window.showErrorMessage(`Error creating new project: ${error}`);
        }
    }

    private async _createNewProject(solutionPath: string, projectName: string, template: string, solutionFolderName?: string): Promise<void> {
        const solutionDir = path.dirname(solutionPath);
        const projectPath = path.join(solutionDir, projectName);

        // Use dotnet CLI to create the project
        const createCommand = `dotnet new ${template} -n "${projectName}" -o "${projectPath}"`;
        this.logger.info(`Executing: ${createCommand}`);

        const { exec } = require('child_process');

        // Create the project
        await new Promise<void>((resolve, reject) => {
            exec(createCommand, { cwd: solutionDir }, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    this.logger.error(`Error creating project:`, error);
                    reject(error);
                } else {
                    this.logger.info(`Successfully created project:`, stdout);
                    resolve();
                }
            });
        });

        // Add the project to the solution
        const projectFile = path.join(projectPath, `${projectName}.csproj`);
        const relativePath = path.relative(solutionDir, projectFile);

        // Build the dotnet sln add command
        let addCommand = `dotnet sln "${solutionPath}" add "${relativePath}"`;
        if (solutionFolderName) {
            addCommand += ` --solution-folder "${solutionFolderName}"`;
        }

        this.logger.info(`Adding project to solution: ${addCommand}`);

        // Execute the add command
        await new Promise<void>((resolve, reject) => {
            exec(addCommand, { cwd: solutionDir }, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    this.logger.error(`Error adding project to solution:`, error);
                    reject(error);
                } else {
                    this.logger.info(`Successfully added project to solution:`, stdout);
                    resolve();
                }
            });
        });

        // Re-initialize the solution to pick up the changes
        const solution = SolutionService.getActiveSolution();
        if (solution) {
            // Trigger a manual webview update to reflect the new project
            this._updateWebview();
        }
    }




    private async _handleExpandNode(nodePath: string, nodeType: string): Promise<void> {
        this.logger.info(`Expanding ${nodeType} node: ${nodePath}`);

        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                this.logger.warn('No active solution for expand operation');
                return;
            }

            // First, set loading state and send updated tree
            await this._setNodeLoadingState(nodePath, true);

            this.logger.info(`Available solutions projects:`, Array.from(solution.projects.keys()));

            // Load the children based on node type
            let children: ProjectNode[] = [];

            if (nodeType === 'solution') {
                // Expanding a solution - get the cached solution tree
                this.logger.info(`Re-expanding solution node: ${nodePath}`);
                const solutionData = await this._getSolutionData();
                if (solutionData && solutionData.length > 0) {
                    const solutionNode = solutionData.find(node => node.path === nodePath);
                    if (solutionNode && solutionNode.children) {
                        children = solutionNode.children;
                    }
                }
            } else if (nodeType === 'project') {
                // Expanding a project - check if we already have children with expansion state
                const project = solution.getProject(nodePath);
                if (project) {
                    // Check if the cached node already has children (from previous expansion)
                    let existingNode: ProjectNode | undefined;
                    if (this._cachedSolutionData) {
                        existingNode = this._findNodeInTree(this._cachedSolutionData, nodePath);
                    }

                    if (existingNode?.children && existingNode.children.length > 0) {
                        // Reuse existing children to preserve expansion state
                        this.logger.info(`Reusing existing children for project: ${project.name}`);
                        children = existingNode.children;

                        // Refresh any expanded folders to catch file system changes
                        await this._refreshExpandedFolders(children, project);
                    } else {
                        // Load fresh children for first-time expansion
                        this.logger.info(`Loading fresh children for project: ${project.name}`);
                        const rootChildren = await project.getRootChildren();
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);

                        // Restore expansion states for nested children within this project
                        await this._restoreExpansionStates(children, { parentPath: nodePath, updateCache: false });
                    }

                    // Create lazy folder watcher for the project root directory
                    const projectDir = require('path').dirname(nodePath);
                    this.logger.info(`Creating lazy folder watcher for project root: ${projectDir}`);
                    project.createFolderWatcher(projectDir);
                } else {
                    this.logger.warn(`Could not find project instance: ${nodePath}`);
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - get the project and load its dependencies
                const projectPath = nodePath.replace('/dependencies', ''); // Remove the '/dependencies' suffix
                const project = solution.getProject(projectPath);
                if (project) {
                    this.logger.info(`Using Project.getDependencies() for: ${projectPath}`);
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                } else {
                    this.logger.warn(`Could not find project instance for dependencies: ${projectPath}`);
                }
            } else if (nodeType === 'folder') {
                // Expanding a folder within a project using the new Project methods
                const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        this.logger.info(`Using Project.getFolderChildren() for: ${nodePath}`);
                        const folderChildren = await project.getFolderChildren(nodePath);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                        // Create lazy folder watcher for this expanded folder
                        this.logger.info(`Creating lazy folder watcher for: ${nodePath}`);
                        project.createFolderWatcher(nodePath);
                    }
                }
            } else if (nodeType === 'solutionFolder') {
                // Expanding a solution folder - get its children from the solution tree
                this.logger.info(`Expanding solution folder: ${nodePath}`);
                const solutionData = await this._getSolutionData();
                if (solutionData && solutionData.length > 0) {
                    // Find the solution folder in the tree and get its children
                    const findSolutionFolder = (nodes: any[], targetPath: string): any => {
                        for (const node of nodes) {
                            if (node.path === targetPath) {
                                return node;
                            }
                            if (node.children) {
                                const found = findSolutionFolder(node.children, targetPath);
                                if (found) return found;
                            }
                        }
                        return null;
                    };

                    const solutionFolder = findSolutionFolder(solutionData, nodePath);
                    if (solutionFolder && solutionFolder.children) {
                        children = solutionFolder.children;
                    }
                }
            }

            // Update backend state: set expanded = true and attach children
            await this._updateNodeExpansionState(nodePath, true, children);

            // Clear loading state and send complete updated tree
            await this._setNodeLoadingState(nodePath, false);

        } catch (error) {
            this.logger.error('Error expanding node:', error);
            // Clear loading state on error
            await this._setNodeLoadingState(nodePath, false);
        }
    }

    private async _handleCollapseNode(nodePath: string): Promise<void> {
        this.logger.info(`Collapsing node: ${nodePath}`);

        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                this.logger.warn('No active solution for collapse operation');
                return;
            }

            // Find the project that contains this path and collapse it in the project state
            const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
            if (projectPath) {
                const project = solution.getProject(projectPath);
                if (project) {
                    project.collapseFolder(nodePath);

                    // Remove lazy folder watcher for this collapsed folder
                    this.logger.info(`Removing lazy folder watcher for: ${nodePath}`);
                    project.removeFolderWatcher(nodePath);
                }
            }

            // Update backend state: set expanded = false (but preserve children for re-expansion)
            await this._updateNodeExpansionState(nodePath, false);

        } catch (error) {
            this.logger.error('Error collapsing node:', error);
        } finally {
            await this._setNodeLoadingState(nodePath, false);
        }
    }


    /**
     * Sets the loading state for a specific node
     */
    private async _setNodeLoadingState(nodePath: string, isLoading: boolean): Promise<void> {
        // Update the loading state in our cached data if available
        if (this._cachedSolutionData) {
            SolutionTreeService.updateNodeInTree(this._cachedSolutionData, nodePath, { isLoading });
        }

        // Send the current tree with updated loading state
        await this._sendCompleteTreeUpdate();
    }

    /**
     * Updates the expansion state and children for a specific node
     */
    private async _updateNodeExpansionState(nodePath: string, expanded: boolean, children?: ProjectNode[]): Promise<void> {
        // Update the expansion state in our cached data
        if (this._cachedSolutionData) {
            const updates: Partial<ProjectNode> = { expanded, isLoading: false };
            if (children !== undefined) {
                updates.children = children;
                updates.hasChildren = children.length > 0;
                updates.isLoaded = true;
            }
            SolutionTreeService.updateNodeInTree(this._cachedSolutionData, nodePath, updates);
        }

        // Update expansion state in persistent storage
        const expandedNodes = this.getExpandedNodePaths(this._cachedSolutionData || []);
        this.saveExpansionState(expandedNodes);
    }

    /**
     * Recursively updates a node in the tree
     */

    /**
     * Gets all expanded node paths from the tree
     */
    private getExpandedNodePaths(nodes: ProjectNode[]): string[] {
        const expandedPaths: string[] = [];

        const traverse = (nodeList: ProjectNode[]) => {
            for (const node of nodeList) {
                if (node.expanded) {
                    expandedPaths.push(node.path);
                }
                if (node.children) {
                    traverse(node.children);
                }
            }
        };

        traverse(nodes);
        return expandedPaths;
    }

    /**
     * Sends the complete current tree state to the webview
     */
    private async _sendCompleteTreeUpdate(): Promise<void> {
        this.logger.debug('Sending complete tree update');

        if (!this._view) {
            return;
        }

        try {
            // Get fresh solution data but preserve expansion and loading states from cache
            const freshSolutionData = await this._getSolutionData();

            if (this._cachedSolutionData && freshSolutionData) {
                // Merge the expansion/loading states from cache with fresh data
                SolutionTreeService.mergeTreeStates(freshSolutionData, this._cachedSolutionData);
            }

            // Update cache with the merged data
            this._cachedSolutionData = freshSolutionData;
            this._cacheTimestamp = Date.now();

            // Get frameworks for complete update
            const frameworks = await this._frameworkService.getAvailableFrameworks();
            const activeFramework = this._frameworkService.getActiveFramework();

            this.logger.info('Sending updateSolution message with', freshSolutionData?.length || 0, 'projects');
            this._view.webview.postMessage({
                command: 'updateSolution',
                projects: freshSolutionData || [],
                frameworks: frameworks,
                activeFramework: activeFramework
            });

        } catch (error) {
            this.logger.error('Error sending complete tree update:', error);
        }
    }

    /**
     * Merges expansion and loading states from cached tree into fresh tree
     */



    /**
     * Unified method to restore expansion states with flexible options
     */
    private async _restoreExpansionStates(
        treeData: ProjectNode[],
        options: {
            expansionPaths?: string[]; // Use specific paths instead of workspace storage
            parentPath?: string;       // Filter to children of this parent only
            updateCache?: boolean;     // Whether to update cache (default true)
        } = {}
    ): Promise<void> {
        try {
            // Determine source of expansion paths
            let expansionPaths: string[];
            if (options.expansionPaths) {
                expansionPaths = options.expansionPaths;
                this.logger.debug('Restoring specific expansion states:', expansionPaths.length, 'paths');
            } else {
                expansionPaths = this.getExpansionState();
                this.logger.debug('Restoring expansion states:', expansionPaths.length, 'paths');
            }

            if (!expansionPaths || expansionPaths.length === 0) {
                this.logger.info('No expansion paths to restore');
                return;
            }

            // Filter by parent path if specified
            if (options.parentPath) {
                expansionPaths = expansionPaths.filter(path =>
                    path.startsWith(options.parentPath!) && path !== options.parentPath
                );
                this.logger.info(`Filtered to ${expansionPaths.length} nested paths under: ${options.parentPath}`);
            }

            // Get all valid paths from current tree and clean up stale ones
            const validPaths = SolutionTreeService.getAllValidPathsFromTree(treeData);
            const cleanedExpandedNodes = expansionPaths.filter(path => validPaths.has(path));

            this.logger.info('Valid expansion paths after cleanup:', cleanedExpandedNodes.length);
            if (cleanedExpandedNodes.length !== expansionPaths.length) {
                this.logger.info('Removed stale paths:', expansionPaths.length - cleanedExpandedNodes.length);
            }

            // Restore expansion states and load children
            for (const expandedPath of cleanedExpandedNodes) {
                const nodeType = SolutionTreeService.getNodeTypeForPath(expandedPath, treeData);
                if (nodeType) {
                    this.logger.info(`Restoring expansion for: ${expandedPath} (${nodeType})`);

                    // Set expanded = true in the tree
                    SolutionTreeService.updateNodeInTree(treeData, expandedPath, { expanded: true });

                    // Load children for the expanded node
                    await this._loadChildrenForNode(expandedPath, nodeType, treeData);
                }
            }

            // Update cache if requested (default true)
            if (options.updateCache !== false) {
                this._cachedSolutionData = treeData;
                this._cacheTimestamp = Date.now();
            }

        } catch (error) {
            this.logger.error('Error restoring expansion states:', error);
        }
    }

    /**
     * Finds a specific node in the tree by path
     */
    private _findNodeInTree(nodes: ProjectNode[], targetPath: string): ProjectNode | undefined {
        for (const node of nodes) {
            if (node.path === targetPath) {
                return node;
            }
            if (node.children) {
                const found = this._findNodeInTree(node.children, targetPath);
                if (found) return found;
            }
        }
        return undefined;
    }

    /**
     * Refreshes expanded folders to catch file system changes while preserving expansion state
     */
    private async _refreshExpandedFolders(children: ProjectNode[], project: any): Promise<void> {
        for (const child of children) {
            if (child.type === 'folder' && child.expanded && child.children) {
                this.logger.info(`Refreshing expanded folder: ${child.path}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(child.path);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing children to preserve nested expansion states
                    child.children = this._mergeChildrenArrays(child.children, freshChildren);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    this.logger.warn(`Error refreshing folder ${child.path}:`, error);
                }
            }
        }
    }

    /**
     * Merges existing children with fresh children, preserving expansion states
     */
    private _mergeChildrenArrays(existingChildren: ProjectNode[], freshChildren: ProjectNode[]): ProjectNode[] {
        const result: ProjectNode[] = [];
        const existingMap = new Map<string, ProjectNode>();

        // Build map of existing children by path
        for (const child of existingChildren) {
            existingMap.set(child.path, child);
        }

        // Merge fresh children with existing expansion states
        for (const freshChild of freshChildren) {
            const existing = existingMap.get(freshChild.path);
            if (existing) {
                // Keep expansion state and children from existing node
                result.push({
                    ...freshChild,
                    expanded: existing.expanded,
                    children: existing.children,
                    isLoaded: existing.isLoaded
                });
            } else {
                // New child, use fresh data
                result.push(freshChild);
            }
        }

        return result;
    }

    /**
     * Gets all valid paths from the tree structure
     */


    /**
     * Gets the node type for a given path from the tree
     */

    /**
     * Loads children for a specific node during restoration
     */
    private async _loadChildrenForNode(nodePath: string, nodeType: string, treeData: ProjectNode[]): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                return;
            }

            let children: ProjectNode[] = [];

            if (nodeType === 'solution') {
                // Solution children are already loaded in the initial tree
                return;
            } else if (nodeType === 'project') {
                const project = solution.getProject(nodePath);
                if (project) {
                    const rootChildren = await project.getRootChildren();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);
                }
            } else if (nodeType === 'dependencies') {
                const projectPath = nodePath.replace('/dependencies', '');
                const project = solution.getProject(projectPath);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                }
            } else if (nodeType === 'folder') {
                const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        const folderChildren = await project.getFolderChildren(nodePath);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);
                    }
                }
            }

            if (children.length > 0) {
                // Update the node in the tree with its children
                SolutionTreeService.updateNodeInTree(treeData, nodePath, {
                    children,
                    hasChildren: true,
                    isLoaded: true
                });

                // Create folder watcher for restored expanded folders
                if (nodeType === 'folder') {
                    const solution = SolutionService.getActiveSolution();
                    const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
                    if (solution && projectPath) {
                        const project = solution.getProject(projectPath);
                        if (project) {
                            this.logger.info(`Creating folder watcher for restored folder: ${nodePath}`);
                            project.createFolderWatcher(nodePath);
                        }
                    }
                } else if (nodeType === 'project') {
                    const solution = SolutionService.getActiveSolution();
                    if (solution) {
                        const project = solution.getProject(nodePath);
                        if (project) {
                            const projectDir = require('path').dirname(nodePath);
                            this.logger.info(`Creating folder watcher for restored project: ${projectDir}`);
                            project.createFolderWatcher(projectDir);
                        }
                    }
                }
            }

        } catch (error) {
            this.logger.error(`Error loading children for ${nodePath}:`, error);
        }
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
            this.logger.error('Error removing project from solution:', error);
            return false;
        }
    }

    private async _updateWebview() {
        if (!this._view) {
            this.logger.info('No webview available, skipping update');
            return;
        }

        // Check for rapid updates that might be caused by external extensions
        const now = Date.now();
        if (this._lastUpdateTimestamp && (now - this._lastUpdateTimestamp) < this._rapidUpdateWindow) {
            this._rapidUpdateCount++;
            this.logger.info(`Rapid update detected (${this._rapidUpdateCount}/${this._rapidUpdateThreshold})`);
        } else {
            this._rapidUpdateCount = 1;
        }
        this._lastUpdateTimestamp = now;

        // If we detect rapid updates, preserve the current expansion state
        if (this._rapidUpdateCount >= this._rapidUpdateThreshold && this._cachedSolutionData) {
            this.logger.info('RAPID UPDATES DETECTED - Preserving current expansion state');
            this._protectedExpansionState = this.getExpandedNodePaths(this._cachedSolutionData);
        } else {
            this.logger.debug('Manual operation detected - skipping rapid update protection');
        }

        try {
            // Use VS Code progress indicator instead of loading message
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "Loading solution",
                cancellable: false
            }, async (progress) => {
                // Load data asynchronously to prevent blocking
                this.logger.info('Loading solution data and frameworks...');
                progress.report({ increment: 30, message: "Reading solution file..." });

                const [solutionData, frameworks] = await Promise.all([
                    this._getSolutionData(),
                    this._frameworkService.getAvailableFrameworks()
                ]);

                progress.report({ increment: 40, message: "Processing project data..." });

                const activeFramework = this._frameworkService.getActiveFramework();

                this.logger.info('Loaded data:', {
                    projectCount: solutionData.length,
                    frameworkCount: frameworks?.length || 0,
                    activeFramework
                });

                progress.report({ increment: 30, message: "Updating tree view..." });

                this.logger.info('Sending solution data to webview');
                const data: SolutionData = {
                    projects: solutionData,
                    frameworks: frameworks || [],
                    activeFramework
                }

                this.logger.info('Sending solutionData message with', data.projects?.length || 0, 'projects');
                this._view?.webview.postMessage({
                    command: 'solutionData',
                    data
                });
            });
        } catch (error) {
            this.logger.error('Error updating solution webview:', error);
            this._view?.webview.postMessage({
                command: 'error',
                message: 'Failed to load solution data'
            });
        }
    }

    private async _getSolutionData(): Promise<ProjectNode[]> {
        this.logger.info('Getting solution data...');

        // Check cache first for better expand performance
        const now = Date.now();
        if (this._cachedSolutionData &&
            this._cacheTimestamp &&
            (now - this._cacheTimestamp) < this._cacheTimeout) {
            this.logger.info('Using cached solution data');
            return this._cachedSolutionData;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.logger.info('Workspace root:', workspaceRoot);

        // Use the new solution discovery and initialization
        const solution = await SolutionService.discoverAndInitializeSolution(workspaceRoot);
        if (!solution) {
            this.logger.info('No solution found or failed to initialize');
            return [];
        }

        // Store the current solution path for later use
        this._currentSolutionPath = solution.solutionPath;

        // Get solution file data
        const solutionData = solution.solutionFile;
        if (!solutionData) {
            this.logger.info('Failed to get solution data');
            return [];
        }

        this.logger.info('Got solution data:', solutionData);

        this._frameworkService.setSolution(solution.solutionPath, solutionData);

        // Convert solution data to tree structure for the React component
        const treeStructure = await this._convertToTreeStructureWithLazyLoading(solution);

        // Check if we should use protected expansion state due to rapid updates
        if (this._protectedExpansionState) {
            this.logger.info('Using PROTECTED expansion state due to rapid updates');
            await this._restoreExpansionStates(treeStructure, { expansionPaths: this._protectedExpansionState });
            // Clear the protected state after one use
            this._protectedExpansionState = undefined;
        } else {
            // Restore expansion states if this is initial load (this modifies solutionData in place)
            this.logger.info('About to restore expansion states...');
            await this._restoreExpansionStates(treeStructure);
            this.logger.info('Finished restoring expansion states');
        }

        return treeStructure;
    }

    private async _convertToTreeStructureWithLazyLoading(solution: Solution): Promise<ProjectNode[]> {
        if (!solution.solutionFile) return [];

        // Use the tree service to build the solution tree
        const result = await SolutionTreeService.buildSolutionTree(solution);

        // Cache the result for faster subsequent calls
        this._cachedSolutionData = result;
        this._cacheTimestamp = Date.now();
        this.logger.info('Cached solution data');

        return result;
    }

    /**
     * Clear cached solution data when solution changes
     */
    private _clearCache() {
        this._cachedSolutionData = undefined;
        this._cacheTimestamp = undefined;
        this.logger.info('Cache cleared');
    }







    public refresh() {
        this.logger.debug('Refresh called');

        // Don't refresh if we're in the middle of a rename operation
        if (this._isRenaming) {
            this.logger.debug('Skipping refresh during rename operation');
            return;
        }


        // Use incremental update instead of full refresh
        this._updateWebview();
    }

    private saveExpansionState(expandedNodes: string[]) {
        this.logger.debug('Saving expansion state to workspace:', expandedNodes.length, 'nodes');
        this.logger.debug('Expansion paths:', expandedNodes);
        this._context.workspaceState.update('solutionTreeExpanded', expandedNodes);
    }


    /**
     * Dispose method to clean up resources
     */
    dispose(): void {
        // No cleanup needed currently
    }

    private getExpansionState(): string[] {
        const state = this._context.workspaceState.get('solutionTreeExpanded', []);
        this.logger.debug('Retrieved expansion state from workspace:', state.length, 'nodes');
        if (state.length > 0) {
            this.logger.debug('Restored expansion paths:', state);
        }
        return state;
    }

    private async _sendCurrentData() {
        this.logger.debug('Sending current data to webview');

        if (!this._view) {
            this.logger.info('No webview available, skipping send');
            return;
        }

        try {
            this.logger.info('Rebuilding solution data for reconnection');
            const solutionData = await this._getSolutionData();
            const frameworks = await this._frameworkService.getAvailableFrameworks();

            const data: SolutionData = {
                projects: solutionData,
                frameworks: frameworks,
                activeFramework: this._frameworkService.getActiveFramework()
            };

            this.logger.info('Sending solutionData to reconnected webview with', data.projects?.length || 0, 'projects');
            this._view.webview.postMessage({
                command: 'solutionData',
                data: data
            });

        } catch (error) {
            this.logger.error('Error sending current data:', error);
            // Fallback to full update on error
            this._updateWebview();
        }
    }

    public async handleProjectAdded(projectPath: string) {
        this.logger.debug(`Project added via file watcher: ${projectPath}`);
        this._updateWebview(); // Simple full refresh
    }

    public handleProjectRemoved(projectPath: string) {
        this.logger.debug(`Project removed via file watcher: ${projectPath}`);
        this._updateWebview(); // Simple full refresh
    }

    public handleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        this.logger.debug(`Queueing file ${changeType}: ${filePath}`);


        // Check if we already have a event for this file to avoid duplicates
        const existingEventIndex = this._fileChangeQueue.findIndex(event =>
            event.filePath === filePath &&
            event.changeType === changeType
        );

        if (existingEventIndex >= 0) {
            this.logger.info(`Ignoring duplicate file change event for: ${filePath}`);
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
                this.logger.info(`Processing queued file ${event.changeType}: ${event.filePath}`);

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
            this.logger.debug(`Solution file ${changeType}: ${filePath}`);
            if (changeType === 'deleted') {
                // Solution file was deleted - clear everything
                this._view?.webview.postMessage({
                    command: 'solutionDataUpdate',
                    projects: [],
                    frameworks: []
                });
            } else {
                this._clearCache(); // Clear cached data so fresh data is loaded
                this._updateWebview(); // Simple full refresh
            }
        } else if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) {
            // Project file changes
            if (changeType === 'created') {
                this.logger.debug(`Project file created: ${filePath}`);
                await this.handleProjectAdded(filePath);
            } else if (changeType === 'deleted') {
                this.logger.debug(`Project file deleted: ${filePath}`);
                this.handleProjectRemoved(filePath);
            } else {
                this.logger.debug(`Project file content changed: ${fileName}`);
                this._updateWebview(); // Simple full refresh
            }
        } else {
            // All other files - use simple full refresh
            this.logger.debug(`File ${changeType}: ${fileName}`);
            this._updateWebview(); // Simple full refresh
        }
    }
}