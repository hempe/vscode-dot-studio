import * as vscode from 'vscode';
import * as path from 'path';
import { NuGetService } from '../../services/nugetService';
import { NuGetManagerService } from '../../services/nuget/nugetManagerService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';

/**
 * Custom editor provider for NuGet Package Manager that opens in the main editor area
 */
export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'dotnet.nugetPackageManager';
    private readonly logger = logger('NuGetCustomEditorProvider');
    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _nugetService: NuGetService
    ) { }

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Parse context and target from the document URI
        const context = this._getContextFromUri(document.uri);

        // Store the webview panel for message handling
        this._webviewPanels.set(document.uri.toString(), webviewPanel);

        // Clean up on dispose
        webviewPanel.onDidDispose(() => {
            this._webviewPanels.delete(document.uri.toString());
        });

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview')
            ]
        };

        webviewPanel.webview.html = NuGetWebview.getHtmlForWebview(this._extensionUri, webviewPanel.webview);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            message => this._handleMessage(message, document, context, webviewPanel.webview),
            undefined,
            []
        );

        // Send initial data when webview is ready
        this._updateWebview(webviewPanel.webview, context);
    }

    private async _handleMessage(message: any, document: vscode.TextDocument, context: { type: 'project' | 'solution', target: string }, webview: vscode.Webview) {

        try {
            switch (message.command) {
                case 'getNuGetData':
                    await this._updateWebview(webview, context);
                    break;

                case 'searchPackages':
                    await this._handleSearchPackages(message, webview, context);
                    break;

                case 'getInstalledPackages':
                    await this._handleGetInstalledPackages(webview, context);
                    break;

                case 'getUpdatesPackages':
                    await this._handleGetUpdatesPackages(webview, context);
                    break;

                case 'getConsolidatePackages':
                    await this._handleGetConsolidatePackages(webview, context);
                    break;

                case 'packageAction':
                    await this._handlePackageAction(message, webview, context);
                    break;

                case 'consolidatePackage':
                    await this._handleConsolidatePackage(message, webview, context);
                    break;

                case 'bulkUpdatePackages':
                    await this._handleBulkUpdatePackages(message, webview, context);
                    break;

                case 'updateAllPackages':
                    await this._handleUpdateAllPackages(message, webview, context);
                    break;

                case 'debug':
                    this.logger.info('Debug from webview:', message.message);
                    break;

                default:
                    this.logger.warn('Unknown message command:', message.command);
            }
        } catch (error) {
            this.logger.error('Error handling message:', error);
            webview.postMessage({
                command: 'error',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }

    private async _updateWebview(webview?: vscode.Webview, context?: { type: 'project' | 'solution', target: string }) {
        if (!webview) {
            return;
        }

        try {
            // Get NuGet data based on context (project vs solution)
            const nugetData = await this._getNuGetData(context);

            webview.postMessage({
                command: 'nugetData',
                data: nugetData
            });

        } catch (error) {
            this.logger.error('Error updating NuGet webview:', error);
        }
    }

    /**
     * Static method to open the NuGet Package Manager in the editor for a specific project
     */
    public static async openNuGetManager(context: vscode.ExtensionContext, projectPath?: string): Promise<void> {
        try {
            // Create a virtual document for the NuGet Package Manager
            const fileName = projectPath
                ? `NuGet Package Manager - ${path.basename(projectPath, path.extname(projectPath))}.nuget`
                : 'NuGet Package Manager.nuget';

            const uri = vscode.Uri.parse(`untitled:${fileName}?context=project&target=${encodeURIComponent(projectPath || '')}`);

            // Open the document with our custom editor
            await vscode.commands.executeCommand('vscode.openWith', uri, NuGetCustomEditorProvider.viewType);

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening NuGet Package Manager: ${error}`);
        }
    }

    /**
     * Static method to open the NuGet Package Manager in the editor for an entire solution
     */
    public static async openNuGetManagerForSolution(context: vscode.ExtensionContext, solutionPath?: string): Promise<void> {
        try {
            // Create a virtual document for the Solution NuGet Package Manager
            const fileName = solutionPath
                ? `NuGet Package Manager - ${path.basename(solutionPath, path.extname(solutionPath))} Solution.nuget`
                : 'NuGet Package Manager - Solution.nuget';

            const uri = vscode.Uri.parse(`untitled:${fileName}?context=solution&target=${encodeURIComponent(solutionPath || '')}`);

            // Open the document with our custom editor
            await vscode.commands.executeCommand('vscode.openWith', uri, NuGetCustomEditorProvider.viewType);

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening NuGet Package Manager for Solution: ${error}`);
        }
    }

    /**
     * Parse context information from the document URI
     */
    private _getContextFromUri(uri: vscode.Uri): { type: 'project' | 'solution', target: string } {
        const query = new URLSearchParams(uri.query);
        const contextType = query.get('context') as 'project' | 'solution' || 'project';
        const target = decodeURIComponent(query.get('target') || '');

        return {
            type: contextType,
            target
        };
    }

    /**
     * Get NuGet data based on context (project vs solution)
     */
    private async _getNuGetData(context?: { type: 'project' | 'solution', target: string }) {
        if (!context) {
            return {
                context: 'unknown',
                projects: [],
                installedPackages: [],
                availablePackages: []
            };
        }

        try {
            if (context.type === 'solution') {
                // Return solution-wide NuGet data
                const solutionData = await NuGetManagerService.getSolutionNuGetData(context.target);
                return {
                    ...solutionData,
                    context: 'solution',
                    target: context.target,
                    solutionPath: context.target
                };
            } else {
                // Return project-specific NuGet data
                const projectData = await NuGetManagerService.getProjectNuGetData(context.target);
                return {
                    ...projectData,
                    context: 'project',
                    target: context.target,
                    projectPath: context.target
                };
            }
        } catch (error) {
            this.logger.error('Error getting NuGet data:', error);
            return {
                context: context.type,
                target: context.target,
                error: error instanceof Error ? error.message : 'Failed to load NuGet data'
            };
        }
    }

    private async _handleSearchPackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const results = context.type === 'solution'
                ? await NuGetManagerService.searchPackagesForSolution(message.query, { includePrerelease: message.includePrerelease })
                : await NuGetManagerService.searchPackagesForProject(context.target, message.query, { includePrerelease: message.includePrerelease });

            webview.postMessage({
                command: 'searchResults',
                data: results
            });
        } catch (error) {
            this.logger.error('Error searching packages:', error);
            webview.postMessage({
                command: 'searchResults',
                data: [],
                error: error instanceof Error ? error.message : 'Search failed'
            });
        }
    }

    private async _handleGetInstalledPackages(webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const data = await this._getNuGetData(context);
            webview.postMessage({
                command: 'installedPackages',
                data: data.installedPackages || []
            });
        } catch (error) {
            this.logger.error('Error getting installed packages:', error);
        }
    }

    private async _handleGetUpdatesPackages(webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const data = await this._getNuGetData(context);
            webview.postMessage({
                command: 'updatesPackages',
                data: (data as any).outdatedPackages || []
            });
        } catch (error) {
            this.logger.error('Error getting updates packages:', error);
        }
    }

    private async _handleGetConsolidatePackages(webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            if (context.type === 'solution') {
                const data = await this._getNuGetData(context);
                webview.postMessage({
                    command: 'consolidatePackages',
                    data: (data as any).consolidationInfo || []
                });
            } else {
                webview.postMessage({
                    command: 'consolidatePackages',
                    data: []
                });
            }
        } catch (error) {
            this.logger.error('Error getting consolidate packages:', error);
        }
    }

    private async _handlePackageAction(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            let result;
            const { action, packageId, version } = message;

            switch (action) {
                case 'install':
                    if (context.type === 'project') {
                        result = await NuGetManagerService.installPackageInProject(context.target, packageId, version);
                    } else {
                        // For solution, we need to show project selection - for now just show message
                        vscode.window.showInformationMessage('Solution-wide package installation not yet implemented');
                        return;
                    }
                    break;

                case 'uninstall':
                    if (context.type === 'project') {
                        result = await NuGetManagerService.uninstallPackageFromProject(context.target, packageId);
                    }
                    break;

                case 'update':
                    if (context.type === 'project') {
                        result = await NuGetManagerService.updatePackageInProject(context.target, packageId, version);
                    }
                    break;
            }

            if (result) {
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    // Refresh the current tab
                    await this._updateWebview(webview, context);
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            }
        } catch (error) {
            this.logger.error('Error performing package action:', error);
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleConsolidatePackage(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            if (context.type === 'solution') {
                // For now, consolidate to latest version across all projects
                // In a full implementation, you'd show a dialog to select target version
                const result = await NuGetManagerService.consolidatePackages(context.target);

                const successful = result.filter(r => r.success).length;
                const failed = result.length - successful;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully consolidated ${message.packageId}`);
                } else {
                    vscode.window.showWarningMessage(`Consolidated ${message.packageId}: ${successful} successful, ${failed} failed`);
                }

                // Refresh the consolidate tab
                await this._handleGetConsolidatePackages(webview, context);
            }
        } catch (error) {
            this.logger.error('Error consolidating package:', error);
            vscode.window.showErrorMessage(`Error consolidating package: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleBulkUpdatePackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const { packages } = message;

            if (!packages || !Array.isArray(packages) || packages.length === 0) {
                vscode.window.showWarningMessage('No packages selected for update');
                return;
            }

            this.logger.info(`Bulk updating ${packages.length} packages`);

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating ${packages.length} packages...`,
                cancellable: false
            }, async (progress) => {
                const results = [];
                let completed = 0;

                for (const pkg of packages) {
                    progress.report({
                        increment: (100 / packages.length),
                        message: `Updating ${pkg.id}...`
                    });

                    try {
                        let result;
                        if (context.type === 'project') {
                            result = await NuGetManagerService.updatePackageInProject(
                                context.target,
                                pkg.id,
                                pkg.latestVersion
                            );
                        } else {
                            // For solution context, update in the specific project
                            result = await NuGetManagerService.updatePackageInProject(
                                pkg.projectPath,
                                pkg.id,
                                pkg.latestVersion
                            );
                        }
                        results.push(result);
                        completed++;
                    } catch (error) {
                        this.logger.error(`Error updating ${pkg.id}:`, error);
                        results.push({
                            success: false,
                            message: `Failed to update ${pkg.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            packageId: pkg.id
                        });
                    }
                }

                const successful = results.filter(r => r.success).length;
                const failed = results.length - successful;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully updated ${successful} packages`);
                } else if (successful === 0) {
                    vscode.window.showErrorMessage(`Failed to update all ${failed} packages`);
                } else {
                    vscode.window.showWarningMessage(`Updated ${successful} packages, ${failed} failed`);
                }
            });

            // Refresh the updates tab
            await this._handleGetUpdatesPackages(webview, context);

        } catch (error) {
            this.logger.error('Error performing bulk package updates:', error);
            vscode.window.showErrorMessage(`Error updating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleUpdateAllPackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            this.logger.info('Updating all packages');

            // Get all outdated packages first
            const data = await this._getNuGetData(context);
            const outdatedPackages = (data as any).outdatedPackages || [];

            if (outdatedPackages.length === 0) {
                vscode.window.showInformationMessage('No packages need updating');
                return;
            }

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating all ${outdatedPackages.length} packages...`,
                cancellable: false
            }, async (progress) => {
                const results = [];
                let completed = 0;

                for (const pkg of outdatedPackages) {
                    progress.report({
                        increment: (100 / outdatedPackages.length),
                        message: `Updating ${pkg.id}...`
                    });

                    try {
                        let result;
                        if (context.type === 'project') {
                            result = await NuGetManagerService.updatePackageInProject(
                                context.target,
                                pkg.id,
                                pkg.latestVersion
                            );
                        } else {
                            // For solution context, update in the specific project
                            result = await NuGetManagerService.updatePackageInProject(
                                pkg.projectPath,
                                pkg.id,
                                pkg.latestVersion
                            );
                        }
                        results.push(result);
                        completed++;
                    } catch (error) {
                        this.logger.error(`Error updating ${pkg.id}:`, error);
                        results.push({
                            success: false,
                            message: `Failed to update ${pkg.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            packageId: pkg.id
                        });
                    }
                }

                const successful = results.filter(r => r.success).length;
                const failed = results.length - successful;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully updated all ${successful} packages`);
                } else if (successful === 0) {
                    vscode.window.showErrorMessage(`Failed to update all ${failed} packages`);
                } else {
                    vscode.window.showWarningMessage(`Updated ${successful} packages, ${failed} failed`);
                }
            });

            // Refresh the updates tab
            await this._handleGetUpdatesPackages(webview, context);

        } catch (error) {
            this.logger.error('Error updating all packages:', error);
            vscode.window.showErrorMessage(`Error updating all packages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

}