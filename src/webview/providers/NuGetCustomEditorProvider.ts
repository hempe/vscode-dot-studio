import * as vscode from 'vscode';
import * as path from 'path';
import { NuGetManagerService } from '../../services/nuget/nugetManagerService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';
import { LocalNuGetPackage } from '../nuget-view/shared';

const log = logger('NuGetCustomEditorProvider');

/**
 * Custom editor provider for NuGet Package Manager that opens in the main editor area
 */
export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'dotnet.nugetPackageManager';
    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext
    ) {
    }

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
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
                this._extensionContext.globalStorageUri // Allow access to icon cache
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
            // Add debug logging to see if messages are reaching the provider
            log.info('NuGetCustomEditorProvider received message:', {
                type: message.type,
                command: message.command,
                payload: message.payload
            });

            // Handle both old (command) and new (type) message formats
            const messageType = message.command || message.type;

            switch (messageType) {
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

                case 'installPackage':
                    await this._handleInstallPackage(message, webview, context);
                    break;

                case 'uninstallPackage':
                    await this._handleUninstallPackage(message, webview, context);
                    break;

                case 'consolidatePackage':
                    await this._handleConsolidatePackage(message, webview, context);
                    break;

                case 'bulkUpdatePackages':
                    await this._handleBulkUpdatePackages(message, webview, context);
                    break;

                case 'bulkConsolidatePackages':
                    await this._handleBulkConsolidatePackages(message, webview, context);
                    break;

                case 'updateAllPackages':
                    await this._handleUpdateAllPackages(message, webview, context);
                    break;

                case 'getPackageIcon':
                    const { packageId, version } = message.payload || message;
                    if (packageId && version) {
                        await this._getPackageIcon(packageId, version, webview);
                    }
                    break;

                case 'getPackageReadme':
                    const readmePayload = message.payload || message;
                    if (readmePayload.packageId && readmePayload.version) {
                        await this._getPackageReadme(readmePayload.packageId, readmePayload.version, webview);
                    }
                    break;

                case 'debug':
                    const debugMessage = message.message || message.payload?.message;
                    log.info('Debug from webview:', debugMessage);
                    break;

                default:
                    log.warn('Unknown message command:', messageType);
            }
        } catch (error) {
            log.error('Error handling message:', error);
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
            log.error('Error updating NuGet webview:', error);
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
            log.error('Error getting NuGet data:', error);
            return {
                context: context.type,
                target: context.target,
                error: error instanceof Error ? error.message : 'Failed to load NuGet data'
            };
        }
    }

    private async _handleSearchPackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract query from both message formats
            const query = message.query || message.payload?.query;
            const includePrerelease = message.includePrerelease || message.payload?.includePrerelease || false;

            const results = context.type === 'solution'
                ? await NuGetManagerService.searchPackagesForSolution(query, { includePrerelease })
                : await NuGetManagerService.searchPackagesForProject(context.target, query, { includePrerelease });

            webview.postMessage({
                command: 'searchResults',
                data: results
            });
        } catch (error) {
            log.error('Error searching packages:', error);
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
            log.error('Error getting installed packages:', error);
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
            log.error('Error getting updates packages:', error);
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
            log.error('Error getting consolidate packages:', error);
        }
    }

    private async _handlePackageAction(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            let result;
            // Extract properties from both message formats
            const action = message.action || message.payload?.action;
            const packageId = message.packageId || message.payload?.packageId;
            const version = message.version || message.payload?.version;

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
            log.error('Error performing package action:', error);
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleInstallPackage(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const installData = message.payload || message;
            const installPackage = installData.package;
            const installProjects = installData.projects || [];
            const installVersion = installData.version;

            if (!installPackage || !installProjects.length) {
                vscode.window.showErrorMessage('No projects selected for installation');
                return;
            }

            log.info(`Installing package ${installPackage.id} version ${installVersion} to projects:`, installProjects);

            // Use NuGetManagerService to install the package in multiple projects
            const results = await NuGetManagerService.installPackageInMultipleProjects(
                installPackage.id,
                installVersion,
                installProjects
            );

            // Process results and show appropriate messages
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            if (successful.length > 0) {
                vscode.window.showInformationMessage(
                    `Successfully installed ${installPackage.id}@${installVersion} in ${successful.length} project(s)`
                );
            }

            if (failed.length > 0) {
                log.error('Failed installations:', failed);
                vscode.window.showErrorMessage(
                    `Failed to install ${installPackage.id} in ${failed.length} project(s). Check logs for details.`
                );
            }

            // Refresh the webview
            await this._updateWebview(webview, context);

            // Send completion message to clear loading state
            webview.postMessage({
                command: 'installComplete',
                success: successful.length > 0,
                packageId: installPackage.id
            });
        } catch (error) {
            log.error('Error installing package:', error);
            vscode.window.showErrorMessage(`Failed to install package: ${error}`);

            // Send completion message even on error
            webview.postMessage({
                command: 'installComplete',
                success: false,
                packageId: message.payload?.package?.id || 'unknown'
            });
        }
    }

    private async _handleUninstallPackage(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const uninstallData = message.payload || message;
            const uninstallPackage = uninstallData.package;
            const uninstallProjects = uninstallData.projects || [];

            if (!uninstallPackage || !uninstallProjects.length) {
                vscode.window.showErrorMessage('No projects selected for uninstallation');
                return;
            }

            log.info(`Uninstalling package ${uninstallPackage.id} from projects:`, uninstallProjects);

            // Use NuGetManagerService to uninstall the package from multiple projects
            const results = [];
            for (const projectPath of uninstallProjects) {
                const result = await NuGetManagerService.uninstallPackageFromProject(projectPath, uninstallPackage.id);
                results.push(result);
            }

            // Process results and show appropriate messages
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            if (successful.length > 0) {
                vscode.window.showInformationMessage(
                    `Successfully uninstalled ${uninstallPackage.id} from ${successful.length} project(s)`
                );
            }

            if (failed.length > 0) {
                log.error('Failed uninstallations:', failed);
                vscode.window.showErrorMessage(
                    `Failed to uninstall ${uninstallPackage.id} from ${failed.length} project(s). Check logs for details.`
                );
            }

            // Refresh the webview
            await this._updateWebview(webview, context);

            // Send completion message to clear loading state
            webview.postMessage({
                command: 'uninstallComplete',
                success: successful.length > 0,
                packageId: uninstallPackage.id
            });
        } catch (error) {
            log.error('Error uninstalling package:', error);
            vscode.window.showErrorMessage(`Failed to uninstall package: ${error}`);

            // Send completion message even on error
            webview.postMessage({
                command: 'uninstallComplete',
                success: false,
                packageId: message.payload?.package?.id || 'unknown'
            });
        }
    }

    private async _handleConsolidatePackage(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract packageId from both message formats
            const packageId = message.packageId || message.payload?.packageId;

            if (context.type === 'solution') {
                // For now, consolidate to latest version across all projects
                // In a full implementation, you'd show a dialog to select target version
                const result = await NuGetManagerService.consolidatePackages(context.target);

                const successful = result.filter(r => r.success).length;
                const failed = result.length - successful;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully consolidated ${packageId || 'packages'}`);
                } else {
                    vscode.window.showWarningMessage(`Consolidated ${packageId || 'packages'}: ${successful} successful, ${failed} failed`);
                }

                // Refresh the consolidate tab
                await this._handleGetConsolidatePackages(webview, context);
            }
        } catch (error) {
            log.error('Error consolidating package:', error);
            vscode.window.showErrorMessage(`Error consolidating package: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _handleBulkUpdatePackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract packages from both message formats
            const packages: LocalNuGetPackage[] = message.packages || message.payload?.packages;

            if (!packages || !Array.isArray(packages) || packages.length === 0) {
                vscode.window.showWarningMessage('No packages selected for update');
                return;
            }

            log.info(`Bulk updating ${packages.length} packages`);

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating ${packages.length} packages...`,
                cancellable: false
            }, async (progress) => {
                const results = [];

                for (const pkg of packages) {
                    progress.report({
                        increment: (100 / packages.length),
                        message: `Updating ${pkg.id}...`
                    });

                    try {
                        if (context.type === 'project') {
                            const result = await NuGetManagerService.updatePackageInProject(
                                context.target,
                                pkg.id,
                                pkg.latestVersion
                            );
                            results.push(result);

                        } else {
                            for (const project of pkg.projects || []) {
                                try {
                                    // For solution context, update in the specific project
                                    const result = await NuGetManagerService.updatePackageInProject(
                                        project.path,
                                        pkg.id,
                                        pkg.latestVersion
                                    );
                                    results.push(result);
                                } catch (error) {
                                    log.error(`Error updating ${pkg.id}:`, error);
                                    results.push({
                                        success: false,
                                        message: `Failed to update ${pkg.id} in ${project.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                        packageId: pkg.id
                                    });
                                }

                            }
                        }
                    } catch (error) {
                        log.error(`Error updating ${pkg.id}:`, error);
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

            // Send completion message to frontend
            webview.postMessage({
                command: 'bulkUpdateComplete',
                success: true
            });

        } catch (error) {
            log.error('Error performing bulk package updates:', error);
            vscode.window.showErrorMessage(`Error updating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

            // Send failure completion message
            webview.postMessage({
                command: 'bulkUpdateComplete',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private async _handleBulkConsolidatePackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract packages from both message formats
            const packages: LocalNuGetPackage[] = message.packages || message.payload?.packages;

            if (!packages || !Array.isArray(packages) || packages.length === 0) {
                vscode.window.showWarningMessage('No packages selected for consolidation');
                return;
            }

            log.info(`Bulk consolidating ${packages.length} packages`);

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Consolidating ${packages.length} packages...`,
                cancellable: false
            }, async (progress) => {
                const results = [];

                for (const pkg of packages) {
                    progress.report({
                        increment: (100 / packages.length),
                        message: `Consolidating ${pkg.id}...`
                    });

                    try {
                        // For consolidation, we need to find the target version and affected projects
                        const targetVersion = pkg.latestVersion || pkg.version;

                        if (context.type === 'solution') {
                            // Use the consolidation service to consolidate this specific package
                            const result = await NuGetManagerService.consolidatePackage(
                                context.target,
                                pkg.id,
                                targetVersion
                            );
                            results.push(...result);
                        } else {
                            // For project context, we can't really consolidate (need multiple projects)
                            results.push({
                                success: false,
                                message: `Consolidation requires a solution context, not a single project`,
                                packageId: pkg.id
                            });
                        }

                    } catch (error) {
                        log.error(`Error consolidating ${pkg.id}:`, error);
                        results.push({
                            success: false,
                            message: `Failed to consolidate ${pkg.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            packageId: pkg.id
                        });
                    }
                }

                const successful = results.filter(r => r.success).length;
                const failed = results.length - successful;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully consolidated ${successful} packages`);
                } else if (successful === 0) {
                    vscode.window.showErrorMessage(`Failed to consolidate all ${failed} packages`);
                } else {
                    vscode.window.showWarningMessage(`Consolidated ${successful} packages, ${failed} failed`);
                }
            });

            // Refresh the consolidate tab by refreshing all data
            await this._updateWebview(webview, context);

            // Send completion message to frontend
            webview.postMessage({
                command: 'bulkConsolidateComplete',
                success: true
            });

        } catch (error) {
            log.error('Error performing bulk package consolidation:', error);
            vscode.window.showErrorMessage(`Error consolidating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

            // Send failure completion message
            webview.postMessage({
                command: 'bulkConsolidateComplete',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private async _handleUpdateAllPackages(message: any, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            log.info('Updating all packages');

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
                title: `Updating Packages`,
                cancellable: false
            }, async (progress) => {
                const results = [];
                let completed = 0;

                for (const pkg of outdatedPackages) {
                    progress.report({
                        increment: (100 / outdatedPackages.length),
                        message: `: ${pkg.id}...`
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
                        log.error(`Error updating ${pkg.id}:`, error);
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
            log.error('Error updating all packages:', error);
            vscode.window.showErrorMessage(`Error updating all packages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }


    /**
     * Get a package icon and send it to the webview
     */
    private async _getPackageIcon(packageId: string, version: string, webview: vscode.Webview): Promise<void> {
        try {
            // Use direct NuGet icon URL instead of caching
            const iconUri = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/${version}/icon`;

            webview.postMessage({
                command: 'packageIcon',
                packageId,
                version,
                iconUri
            });
        } catch (error) {
            log.error(`Error getting icon for ${packageId}@${version}:`, error);

            webview.postMessage({
                command: 'packageIcon',
                packageId,
                version,
                iconUri: null
            });
        }
    }

    /**
     * Get a package README URL and send it to the webview
     */
    private async _getPackageReadme(packageId: string, version: string, webview: vscode.Webview): Promise<void> {
        try {
            // Use direct NuGet README URL
            const readmeUrl = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/${version}/readme`;

            webview.postMessage({
                command: 'packageReadme',
                packageId,
                version,
                readmeUrl
            });
        } catch (error) {
            log.error(`Error getting README for ${packageId}@${version}:`, error);

            webview.postMessage({
                command: 'packageReadme',
                packageId,
                version,
                readmeUrl: null
            });
        }
    }

}