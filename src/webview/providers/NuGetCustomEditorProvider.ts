import * as vscode from 'vscode';
import * as path from 'path';
import { NuGetService } from '../../services/nugetService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';

/**
 * Custom editor provider for NuGet Package Manager that opens in the main editor area
 */
export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'dotnet.nugetPackageManager';
    private readonly logger = logger('NuGetCustomEditorProvider');

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
            message => this._handleMessage(message, document),
            undefined,
            []
        );

        // Send initial data when webview is ready
        this._updateWebview(webviewPanel.webview);
    }

    private async _handleMessage(message: any, document: vscode.TextDocument) {
        switch (message.command) {
            case 'getNuGetData':
                await this._updateWebview(undefined);
                break;

            case 'searchPackages':
                if (message.query) {
                    this.logger.info('Searching packages:', message.query);
                    try {
                        const results = await this._nugetService.searchPackages(message.query);
                        // Send results back to webview
                        // Implementation depends on your webview messaging system
                    } catch (error) {
                        this.logger.error('Error searching packages:', error);
                    }
                }
                break;

            case 'installPackage':
                if (message.packageId && message.version && message.projectPath) {
                    this.logger.info('Installing package:', message.packageId, message.version);
                    try {
                        await this._nugetService.installPackage(
                            message.projectPath,
                            message.packageId,
                            message.version
                        );
                        vscode.window.showInformationMessage(`Package ${message.packageId} installed successfully`);
                    } catch (error) {
                        this.logger.error('Error installing package:', error);
                        vscode.window.showErrorMessage(`Error installing package: ${error}`);
                    }
                }
                break;

            case 'uninstallPackage':
                if (message.packageId && message.projectPath) {
                    this.logger.info('Uninstalling package:', message.packageId);
                    try {
                        await this._nugetService.uninstallPackage(message.projectPath, message.packageId);
                        vscode.window.showInformationMessage(`Package ${message.packageId} uninstalled successfully`);
                    } catch (error) {
                        this.logger.error('Error uninstalling package:', error);
                        vscode.window.showErrorMessage(`Error uninstalling package: ${error}`);
                    }
                }
                break;

            default:
                this.logger.warn('Unknown message command:', message.command);
        }
    }

    private async _updateWebview(webview?: vscode.Webview) {
        if (!webview) {
            return;
        }

        try {
            // Get NuGet data and send to webview
            // Implementation depends on your NuGet service
            const nugetData = {
                // Add your NuGet data structure here
                projects: [],
                installedPackages: [],
                availablePackages: []
            };

            webview.postMessage({
                command: 'nugetData',
                data: nugetData
            });

        } catch (error) {
            this.logger.error('Error updating NuGet webview:', error);
        }
    }

    /**
     * Static method to open the NuGet Package Manager in the editor
     */
    public static async openNuGetManager(context: vscode.ExtensionContext, projectPath?: string): Promise<void> {
        try {
            // Create a virtual document for the NuGet Package Manager
            const fileName = projectPath
                ? `NuGet Package Manager - ${path.basename(projectPath, path.extname(projectPath))}.nuget`
                : 'NuGet Package Manager.nuget';

            const uri = vscode.Uri.parse(`untitled:${fileName}`);

            // Open the document with our custom editor
            await vscode.commands.executeCommand('vscode.openWith', uri, NuGetCustomEditorProvider.viewType);

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening NuGet Package Manager: ${error}`);
        }
    }
}