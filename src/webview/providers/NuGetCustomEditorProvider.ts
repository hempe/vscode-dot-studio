import * as vscode from 'vscode';
import { nugetEditorQuery, parseNuGetEditorQuery } from './nugetEditorUri';
import { Settings } from '../../services/settings';
import * as path from 'path';
import { NuGetManagerService } from '../../services/nuget/nugetManagerService';
import { SolutionService } from '../../services/solutionService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';
import { LocalNuGetPackage, sendToUi } from '../nuget-view/shared';
import { changePackageVersions, consolidatePackages, uninstallPackages } from '../../services/nuget/centralPackageOperations';
import { BackendCmd, BulkConsolidatePackagesCmd, BulkUpdatePackagesCmd, InstallPackageCmd, SearchPackagesCmd, UnInstallPackageCmd } from '../../types/commands/backend';
import { NuGetViewData } from '../../types/commands/ui';
import { VersionUtils } from '../../services/versionUtils';
import { solutionWorkspaceFolder } from '../../services/workspaceFolders';
import { ProjectItemsService } from '../../services/projectItems/projectItemsService';

const log = logger('NuGetCustomEditorProvider');

/**
 * Custom editor provider for NuGet Package Manager that opens in the main editor area
 */
export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    public static readonly viewType = 'shinobi.nugetPackageManager';
    private readonly _webviewPanels = new Map<string, { panel: vscode.WebviewPanel; context: { type: 'project' | 'solution', target: string }; includePrerelease: boolean }>();
    // The packages version of each project last seen: a new one (Directory.Packages.props changed) refreshes the open editors
    private readonly _packageVersions = new Map<string, number>();
    private _refreshTimer?: ReturnType<typeof setTimeout>;
    private readonly _evaluations: { dispose(): void };

    /** @param _onFocus re-checks props files no watcher sees (outside the workspace) when an editor gets focus */
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _onFocus: () => Promise<void> = async () => { }
    ) {
        this._evaluations = ProjectItemsService.instance.onDidEvaluate(projectPath => this._packagesEvaluated(projectPath));
    }

    dispose(): void {
        this._evaluations.dispose();
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = undefined;
        }
    }

    /** New package versions of a project: the open editors show them (once per burst of evaluations) */
    private _packagesEvaluated(projectPath: string): void {
        const version = ProjectItemsService.instance.packagesVersion(projectPath);
        if (this._packageVersions.get(projectPath) === version) {
            return;
        }
        this._packageVersions.set(projectPath, version);
        if (this._webviewPanels.size === 0) {
            return;
        }
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
        }
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = undefined;
            for (const { panel, context, includePrerelease } of this._webviewPanels.values()) {
                void this._updateWebview(panel.webview, context, includePrerelease);
            }
        }, 500);
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

        // Store the webview panel for message handling and refreshes
        const entry = { panel: webviewPanel, context, includePrerelease: Settings.nugetIncludePrerelease() };
        this._webviewPanels.set(document.uri.toString(), entry);

        // Clean up on dispose
        webviewPanel.onDidDispose(() => {
            this._webviewPanels.delete(document.uri.toString());
        });

        // Props files outside the workspace have no watcher: look at them when the editor comes to the front
        webviewPanel.onDidChangeViewState(event => {
            if (event.webviewPanel.active) {
                void this._onFocus();
            }
        });

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
                this._extensionContext.globalStorageUri // Allow access to icon cache
            ]
        };

        webviewPanel.webview.html = NuGetWebview.getHtmlForWebview(this._extensionUri, webviewPanel.webview, Settings.nugetIncludePrerelease());

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                if (message.type === 'getNuGetData') {
                    entry.includePrerelease = message.payload.includePrerelease;
                }
                return this._handleMessage(message, context, webviewPanel.webview);
            },
            undefined,
            []
        );

        // Send initial data when webview is ready
        this._updateWebview(webviewPanel.webview, context, false);
    }

    private async _handleMessage(message: BackendCmd, context: { type: 'project' | 'solution', target: string }, webview: vscode.Webview) {

        try {
            // Add debug logging to see if messages are reaching the provider
            log.info('NuGetCustomEditorProvider received message:', message);

            // Handle both old (command) and new (type) message formats
            const messageType = message.type;

            switch (messageType) {
                case 'getNuGetData':
                    await this._updateWebview(webview, context, message.payload.includePrerelease);
                    break;

                case 'searchPackages':
                    await this._handleSearchPackages(message, webview);
                    break;

                case 'getConsolidatePackages':
                    await this._handleGetConsolidatePackages(webview, context, message.payload.includePrerelease);
                    break;

                case 'installPackage':
                    await this._handleInstallPackage(message, webview, context);
                    break;

                case 'uninstallPackage':
                    await this._handleUninstallPackage(message, webview, context);
                    break;

                case 'bulkUpdatePackages':
                    await this._handleBulkUpdatePackages(message, webview, context);
                    break;

                case 'bulkConsolidatePackages':
                    await this._handleBulkConsolidatePackages(message, webview, context);
                    break;

                case 'getPackageIcon':
                    const { packageId, version } = message.payload;
                    if (packageId && version) {
                        await this._getPackageIcon(packageId, version, webview);
                    }
                    break;

                case 'getPackageReadme':
                    const readmePayload = message.payload;
                    if (readmePayload.packageId && readmePayload.version) {
                        await this._getPackageReadme(readmePayload.packageId, readmePayload.version, webview);
                    }
                    break;

                default:
                    log.warn('Unknown message command:', messageType);
            }
        } catch (error) {
            log.error('Error handling message:', error);
            sendToUi(webview, {
                type: 'error',
                payload: {
                    message: error instanceof Error ? error.message : 'Unknown error occurred'
                }
            });
        }
    }

    private async _updateWebview(
        webview: vscode.Webview | null | undefined,
        context: { type: 'project' | 'solution', target: string },
        includePrerelease: boolean) {
        if (!webview) {
            return;
        }

        try {
            // Get NuGet data based on context (project vs solution)
            const nugetData = await this._getNuGetData(context, includePrerelease);

            sendToUi(webview, {
                type: 'nugetData',
                payload: nugetData
            });

        } catch (error) {
            log.error('Error updating NuGet webview:', error);
        }
    }

    /**
     * Static method to open the NuGet Package Manager in the editor for a specific project
     */
    public static async openNuGetManager(projectPath?: string): Promise<void> {
        try {
            // Debug: Check solution state before opening NuGet manager
            const workspaceRoot = solutionWorkspaceFolder()?.uri.fsPath;
            const existingActiveSolution = SolutionService.getActiveSolution();

            log.info(`=== NuGet Manager (Project) Opening Debug ===`);
            log.info(`Project path: ${projectPath}`);
            log.info(`Workspace root: ${workspaceRoot}`);
            log.info(`Existing active solution: ${existingActiveSolution ? 'EXISTS' : 'NULL'}`);
            if (existingActiveSolution) {
                log.info(`Solution path: ${existingActiveSolution.solutionPath}`);
                log.info(`Solution initialized: ${existingActiveSolution.isInitialized}`);
                log.info(`Projects count: ${existingActiveSolution.projects.size}`);
            }

            // Ensure active solution is initialized before opening NuGet manager
            if (workspaceRoot && !existingActiveSolution) {
                log.info(`Initializing active solution for workspace: ${workspaceRoot}`);
                const solution = await SolutionService.discoverAndInitializeSolution();
                if (solution) {
                    log.info(`Active solution initialized: ${solution.solutionPath}`);
                } else {
                    log.warn('Failed to initialize active solution');
                }
            } else if (existingActiveSolution) {
                log.info(`Active solution already available: ${existingActiveSolution.solutionPath}`);
            } else {
                log.warn('No workspace root available for solution initialization');
            }
            log.info(`=== End Debug ===`);

            // Create a virtual document for the NuGet Package Manager
            const fileName = projectPath
                ? `NuGet Package Manager - ${path.basename(projectPath, path.extname(projectPath))}.nuget`
                : 'NuGet Package Manager.nuget';

            const uri = vscode.Uri.from({ scheme: 'untitled', path: fileName, query: nugetEditorQuery({ type: 'project', target: projectPath || '' }) });

            // Open the document with our custom editor
            await vscode.commands.executeCommand('vscode.openWith', uri, NuGetCustomEditorProvider.viewType);

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening NuGet Package Manager: ${error}`);
        }
    }

    /**
     * Static method to open the NuGet Package Manager in the editor for an entire solution
     */
    public static async openNuGetManagerForSolution(solutionPath?: string): Promise<void> {
        try {
            // Debug: Check solution state before opening NuGet manager
            const workspaceRoot = solutionWorkspaceFolder()?.uri.fsPath;
            const existingActiveSolution = SolutionService.getActiveSolution();

            log.info(`=== NuGet Manager Opening Debug ===`);
            log.info(`Workspace root: ${workspaceRoot}`);
            log.info(`Existing active solution: ${existingActiveSolution ? 'EXISTS' : 'NULL'}`);
            if (existingActiveSolution) {
                log.info(`Solution path: ${existingActiveSolution.solutionPath}`);
                log.info(`Solution initialized: ${existingActiveSolution.isInitialized}`);
                log.info(`Projects count: ${existingActiveSolution.projects.size}`);
            }

            // Ensure active solution is initialized before opening NuGet manager
            if (workspaceRoot && !existingActiveSolution) {
                log.info(`Initializing active solution for workspace: ${workspaceRoot}`);
                const solution = await SolutionService.discoverAndInitializeSolution();
                if (solution) {
                    log.info(`Active solution initialized: ${solution.solutionPath}`);
                } else {
                    log.warn('Failed to initialize active solution');
                }
            } else if (existingActiveSolution) {
                log.info(`Active solution already available: ${existingActiveSolution.solutionPath}`);
            } else {
                log.warn('No workspace root available for solution initialization');
            }
            log.info(`=== End Debug ===`);

            // Create a virtual document for the Solution NuGet Package Manager
            const fileName = solutionPath
                ? `NuGet Package Manager - ${path.basename(solutionPath, path.extname(solutionPath))} Solution.nuget`
                : 'NuGet Package Manager - Solution.nuget';

            const uri = vscode.Uri.from({ scheme: 'untitled', path: fileName, query: nugetEditorQuery({ type: 'solution', target: solutionPath || '' }) });

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
        return parseNuGetEditorQuery(uri.query);
    }

    /**
     * Get NuGet data based on context (project vs solution)
     */
    private async _getNuGetData(
        context: { type: 'project' | 'solution', target: string } | null | undefined,
        includePrerelease: boolean): Promise<NuGetViewData> {
        if (!context) {
            return {
                projects: [],
                installedPackages: [],
                updatesAvailable: null,
            };
        }

        try {
            // Ensure active solution is initialized before getting NuGet data
            const workspaceRoot = solutionWorkspaceFolder()?.uri.fsPath;
            const existingActiveSolution = SolutionService.getActiveSolution();

            log.info(`=== _getNuGetData called ===`);
            log.info(`Context: ${context.type}, Target: ${context.target}`);
            log.info(`Workspace root: ${workspaceRoot}`);
            log.info(`Existing active solution: ${existingActiveSolution ? 'EXISTS' : 'NULL'}`);

            if (workspaceRoot && !existingActiveSolution) {
                log.info(`Initializing active solution for workspace: ${workspaceRoot}`);
                const solution = await SolutionService.discoverAndInitializeSolution();
                if (solution) {
                    log.info(`Active solution initialized: ${solution.solutionPath}`);
                } else {
                    log.warn('Failed to initialize active solution');
                }
            } else if (existingActiveSolution) {
                log.info(`Active solution already available: ${existingActiveSolution.solutionPath}`);
            }

            if (context.type === 'solution') {
                // Return solution-wide NuGet data
                const solutionData = await NuGetManagerService.getSolutionNuGetData(context.target, includePrerelease);
                return {
                    updatesAvailable: solutionData.outdatedPackages,
                    installedPackages: solutionData.installedPackages?.map(x => ({
                        ...x,
                        version: x.currentVersion
                    })),
                    transitivePackages: solutionData.transitivePackages,
                    consolidatePackages: [],
                    projects: solutionData.projects,
                    searchResults: [],
                };
            } else {
                // Return project-specific NuGet data
                const projectData = await NuGetManagerService.getProjectNuGetData(context.target, includePrerelease);
                return {
                    updatesAvailable: projectData.outdatedPackages,
                    installedPackages: projectData.installedPackages?.map(x => ({
                        ...x,
                        version: x.currentVersion
                    })),
                    transitivePackages: projectData.transitivePackages,
                    projectPath: projectData.projectPath,
                    consolidatePackages: [],
                    projects: projectData.projects,
                    searchResults: [],
                };
            }
        } catch (error) {
            log.error('Error getting NuGet data:', error);
            return {};
        }
    }

    private async _handleSearchPackages(message: SearchPackagesCmd, webview: vscode.Webview) {
        try {
            // Extract query from both message formats
            const query = message.payload.query;

            const results = await NuGetManagerService.searchPackages(query);

            sendToUi(webview, {
                type: 'searchResults',
                payload: {
                    searchResults: results,
                }
            });
        } catch (error) {
            log.error('Error searching packages:', error);
            sendToUi(webview, {
                type: 'searchResults',
                payload: {
                    searchResults: [],
                    error: error instanceof Error ? error.message : 'Search failed'
                }
            });
        }
    }

    private async _handleGetConsolidatePackages(
        webview: vscode.Webview,
        context: { type: 'project' | 'solution', target: string },
        includePrerelease: boolean) {
        try {
            if (context.type === 'solution') {
                // Lazy load consolidation data
                const consolidationData = await NuGetManagerService.getSolutionNuGetData(context.target, includePrerelease);
                sendToUi(webview, {
                    type: 'consolidatePackages',
                    payload: {
                        consolidatePackages: consolidationData.consolidatePackages
                    }
                });
            } else {
                sendToUi(webview, {
                    type: 'consolidatePackages',
                    payload: {
                        consolidatePackages: []
                    }
                });
            }
        } catch (error) {
            log.error('Error getting consolidate packages:', error);
            sendToUi(webview, {
                type: 'consolidatePackages',
                payload: {
                    consolidatePackages: []
                }
            });
        }
    }

    private async _handleInstallPackage(message: InstallPackageCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const installData = message.payload;
            const installPackage = installData.package;
            const installProjects = installData.projects || [];
            const installVersion = installData.version;

            if (!installPackage || !installProjects.length) {
                vscode.window.showErrorMessage('No projects selected for installation');
                return;
            }

            log.info(`Installing package ${installPackage.id} version ${installVersion} to projects:`, installProjects);

            // Central Package Management edits Directory.Packages.props (asking when that reaches other projects);
            // projects without it go through dotnet add package
            const { cancelled, results } = await changePackageVersions(
                [{ id: installPackage.id, version: installVersion, projects: installProjects }],
                installData.versionScope ?? 'shared'
            );
            if (cancelled) {
                sendToUi(webview, { type: 'installComplete', payload: { success: false, packageId: installPackage.id } });
                return;
            }

            // Process results and show appropriate messages (a central edit is one result for all its projects)
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            if (successful.length > 0) {
                vscode.window.showInformationMessage(failed.length === 0
                    ? `Successfully installed ${installPackage.id}@${installVersion} in ${installProjects.length} project(s)`
                    : `Installed ${installPackage.id}@${installVersion}, with errors`
                );
            }

            if (failed.length > 0) {
                log.error('Failed installations:', failed);
                vscode.window.showErrorMessage(
                    `Failed to install ${installPackage.id} in ${failed.length} project(s). Check logs for details.`
                );
            }

            // Refresh the webview
            await this._updateWebview(webview, context, message.payload.includePrerelease);

            // Send completion message to clear loading state
            sendToUi(webview, {
                type: 'installComplete',
                payload: {
                    success: successful.length > 0,
                    packageId: installPackage.id
                }
            });
        } catch (error) {
            log.error('Error installing package:', error);
            vscode.window.showErrorMessage(`Failed to install package: ${error}`);
            sendToUi(webview, {
                type: 'installComplete',
                payload: {
                    success: false,
                    packageId: message.payload?.package?.id || 'unknown'

                }
            });
        }
    }

    private async _handleUninstallPackage(message: UnInstallPackageCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            const uninstallData = message.payload;
            const uninstallPackage = uninstallData.package;
            const uninstallProjects = uninstallData.projects || [];

            if (!uninstallPackage || !uninstallProjects.length) {
                vscode.window.showErrorMessage('No projects selected for uninstallation');
                return;
            }

            log.info(`Uninstalling package ${uninstallPackage.id} from projects:`, uninstallProjects);

            // dotnet remove package per project; a global package is removed or opted out in the props/project files
            const { cancelled, results } = await uninstallPackages(uninstallPackage.id, uninstallProjects);
            if (cancelled) {
                sendToUi(webview, { type: 'uninstallComplete', payload: { success: false, packageId: uninstallPackage.id } });
                return;
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
            await this._updateWebview(webview, context, message.payload.includePrerelease);

            // Send completion message to clear loading state
            sendToUi(webview, {
                type: 'uninstallComplete',
                payload: {
                    success: successful.length > 0,
                    packageId: uninstallPackage.id
                }
            });
        } catch (error) {
            log.error('Error uninstalling package:', error);
            vscode.window.showErrorMessage(`Failed to uninstall package: ${error}`);
            // Send completion message even on error
            sendToUi(webview, {
                type: 'uninstallComplete',
                payload: {
                    success: false,
                    packageId: message.payload?.package?.id || 'unknown'
                }
            });
        }
    }

    private async _handleBulkUpdatePackages(message: BulkUpdatePackagesCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract packages from both message formats
            const packages: LocalNuGetPackage[] = message.payload.packages;

            if (!packages || !Array.isArray(packages) || packages.length === 0) {
                vscode.window.showWarningMessage('No packages selected for update');
                return;
            }

            log.info(`Bulk updating ${packages.length} packages`);

            // One change per package (central versions are edited once, not once per project), one confirmation for all
            const changes = packages.flatMap(pkg => {
                const version = pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0];
                const projects = context.type === 'project' ? [context.target] : (pkg.projects ?? []).map(project => project.path);
                return version && projects.length > 0 ? [{ id: pkg.id, version, projects }] : [];
            });

            // Show progress notification
            const cancelled = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating ${changes.length} package(s)`,
                cancellable: false
            }, async () => {
                const { cancelled, results } = await changePackageVersions(changes);
                if (cancelled) {
                    return true;
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
                return false;
            });

            // The Installed and Updates tabs show the new versions
            if (!cancelled) {
                await this._updateWebview(webview, context, message.payload.includePrerelease);
            }

            // Send completion message to frontend
            sendToUi(webview, {
                type: 'bulkUpdateComplete',
                payload: {
                    success: !cancelled
                }
            });

        } catch (error) {
            log.error('Error performing bulk package updates:', error);
            vscode.window.showErrorMessage(`Error updating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

            // Send failure completion message
            sendToUi(webview, {
                type: 'bulkUpdateComplete',
                payload: {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
    }

    private async _handleBulkConsolidatePackages(message: BulkConsolidatePackagesCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }) {
        try {
            // Extract packages from both message formats
            const packages: LocalNuGetPackage[] = message.payload.packages;

            if (!packages || !Array.isArray(packages) || packages.length === 0) {
                vscode.window.showWarningMessage('No packages selected for consolidation');
                return;
            }

            log.info(`Bulk consolidating ${packages.length} packages`);

            if (context.type !== 'solution') {
                vscode.window.showWarningMessage('Consolidation needs the solution, not a single project');
                sendToUi(webview, { type: 'bulkConsolidateComplete', payload: { success: false } });
                return;
            }
            // The target of each package: its newest version (prerelease as chosen), else the one it has
            const changes = packages.map(pkg => ({
                id: pkg.id,
                version: pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0]
                    || pkg.currentVersion,
            }));

            // Show progress notification
            const cancelled = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Consolidating`,
                cancellable: false
            }, async () => {
                // Under CPM: one confirmation, the central version set, the overrides removed
                const { cancelled, results } = await consolidatePackages(changes);
                if (cancelled) {
                    return true;
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
                return false;
            });

            // Refresh the consolidate tab data, and the Installed and Updates tabs (they show the versions consolidated)
            await this._handleGetConsolidatePackages(webview, context, message.payload.includePrerelease);
            if (!cancelled) {
                await this._updateWebview(webview, context, message.payload.includePrerelease);
            }

            // Send completion message to frontend
            sendToUi(webview, {
                type: 'bulkConsolidateComplete',
                payload: {
                    success: !cancelled
                }
            });

        } catch (error) {
            log.error('Error performing bulk package consolidation:', error);
            vscode.window.showErrorMessage(`Error consolidating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

            // Send failure completion message
            sendToUi(webview, {
                type: 'bulkConsolidateComplete',
                payload: {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
    }


    /**
     * Get a package icon and send it to the webview
     */
    private async _getPackageIcon(packageId: string, version: string, webview: vscode.Webview): Promise<void> {
        try {
            // Use direct NuGet icon URL instead of caching
            const iconUri = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/${version}/icon`;
            sendToUi(webview, {
                type: 'packageIcon',
                payload: {
                    packageId,
                    version,
                    iconUri
                }
            });
        } catch (error) {
            log.error(`Error getting icon for ${packageId}@${version}:`, error);

            sendToUi(webview, {
                type: 'packageIcon',
                payload: {
                    packageId,
                    version,
                    iconUri: null
                }
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

            sendToUi(webview, {
                type: 'packageReadme',
                payload: {
                    packageId,
                    version,
                    readmeUrl
                }
            });
        } catch (error) {
            log.error(`Error getting README for ${packageId}@${version}:`, error);

            sendToUi(webview, {
                type: 'packageReadme',
                payload: {
                    packageId,
                    version,
                    readmeUrl: null
                }
            });
        }
    }

}