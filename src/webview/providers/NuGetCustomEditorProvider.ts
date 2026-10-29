import * as vscode from 'vscode';
import { nugetEditorQuery, parseNuGetEditorQuery } from './nugetEditorUri';
import { Settings } from '../../services/settings';
import { readSourceMapping } from '../../services/nuget/packageSourceMappingFiles';
import { configStartDir } from '../../services/nuget/feedAuth';
import * as path from 'path';
import { NuGetManagerService } from '../../services/nuget/nugetManagerService';
import { NuGetV3Service } from '../../services/nuget/nugetV3Service';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';
import { sendToUi } from '../nuget-view/shared';
import { BackendCmd } from '../../types/commands/backend';
import { ProjectItemsService } from '../../services/projectItems/projectItemsService';

import { ensureActiveSolution, handleSources, handleSearchPackages, getNuGetData, handleGetConsolidatePackages, handleInstallPackage, handleUninstallPackage, handleBulkUpdatePackages, handleBulkConsolidatePackages, getPackageIcon, getPackageReadme, NuGetHost } from './nuget/nugetMessageHandlers';

const log = logger('NuGetCustomEditorProvider');

/**
 * Custom editor provider for NuGet Package Manager that opens in the main editor area
 */
export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    public static readonly viewType = 'shinobi.nugetPackageManager';
    private readonly _host: NuGetHost = { update: (webview, context, includePrerelease) => this._updateWebview(webview, context, includePrerelease) };
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
        void this._updateWebview(webviewPanel.webview, context, false);
    }

    private async _handleMessage(message: BackendCmd, context: { type: 'project' | 'solution', target: string }, webview: vscode.Webview) {

        try {
            // Add debug logging to see if messages are reaching the provider
            log.debug('NuGetCustomEditorProvider received message:', message);

            // Handle both old (command) and new (type) message formats
            const messageType = message.type;

            switch (messageType) {
                case 'getNuGetData':
                    await this._updateWebview(webview, context, message.payload.includePrerelease);
                    break;

                case 'searchPackages':
                    await handleSearchPackages(message, webview);
                    break;

                case 'refreshNuGet':
                    await NuGetV3Service.clearCaches();
                    await this._updateWebview(webview, context, message.payload.includePrerelease);
                    break;

                case 'getPackageAdvisories': {
                    // After the lists: asking the feeds takes a while; a project or solution without a restore reports nothing
                    const advisories = context ? await NuGetManagerService.getAdvisories(context).catch(error => {
                        log.warn('Could not read the vulnerabilities and deprecations:', error);
                        return {};
                    }) : {};
                    sendToUi(webview, { type: 'packageAdvisories', payload: { advisories } });
                    break;
                }

                case 'getSources':
                case 'addSource':
                case 'removeSource':
                case 'setSourceEnabled':
                    await handleSources(message, webview);
                    break;

                case 'getConsolidatePackages':
                    await handleGetConsolidatePackages(webview, context, message.payload.includePrerelease);
                    break;

                case 'installPackage':
                    await handleInstallPackage(message, webview, context, this._host);
                    break;

                case 'uninstallPackage':
                    await handleUninstallPackage(message, webview, context, this._host);
                    break;

                case 'bulkUpdatePackages':
                    await handleBulkUpdatePackages(message, webview, context, this._host);
                    break;

                case 'bulkConsolidatePackages':
                    await handleBulkConsolidatePackages(message, webview, context, this._host);
                    break;

                case 'getPackageIcon':
                    const { packageId, version } = message.payload;
                    if (packageId && version) {
                        await getPackageIcon(packageId, version, webview);
                    }
                    break;

                case 'getPackageReadme':
                    const readmePayload = message.payload;
                    if (readmePayload.packageId && readmePayload.version) {
                        await getPackageReadme(readmePayload.packageId, readmePayload.version, webview);
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
            const nugetData = await getNuGetData(context, includePrerelease);
            // The dropdown of Browse; a feed that cannot be listed must not keep the lists away
            const sources = await Promise.resolve().then(() => NuGetManagerService.getEnabledSources()).catch(() => []);

            const manageSources = Settings.nugetPackageSources();
            const sourceMapping = manageSources ? readSourceMapping(configStartDir()) : undefined;

            sendToUi(webview, {
                type: 'nugetData',
                payload: { ...nugetData, sources, manageSources, sourceMapping }
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
            await ensureActiveSolution();

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
            await ensureActiveSolution();

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


}