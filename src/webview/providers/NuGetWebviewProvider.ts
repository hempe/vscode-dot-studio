import * as vscode from 'vscode';
import * as path from 'path';
import { NuGetService } from '../../services/nugetService';

export class NuGetWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-nuget-webview';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _nugetService: NuGetService
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
        switch (message.command) {
            case 'getNuGetData':
                await this._updateWebview();
                break;

            case 'searchPackages':
                if (message.query) {
                    await this._searchPackages(message.query);
                }
                break;

            case 'installPackage':
                if (message.package) {
                    await this._installPackage(message.package);
                }
                break;

            case 'uninstallPackage':
                if (message.package) {
                    await this._uninstallPackage(message.package);
                }
                break;
        }
    }

    private async _updateWebview() {
        if (!this._view) {
            return;
        }

        try {
            const installedPackages = await this._getInstalledPackages();

            this._view.webview.postMessage({
                command: 'nugetData',
                data: {
                    installedPackages: installedPackages || [],
                    searchResults: []
                }
            });
        } catch (error) {
            console.error('Error updating NuGet webview:', error);
            this._view.webview.postMessage({
                command: 'error',
                message: 'Failed to load NuGet data'
            });
        }
    }

    private async _searchPackages(query: string) {
        if (!this._view) {
            return;
        }

        try {
            const searchResults = await NuGetService.searchPackages({
                query,
                includePrerelease: false,
                take: 20
            });

            this._view.webview.postMessage({
                command: 'searchResults',
                packages: searchResults || []
            });
        } catch (error) {
            console.error('Error searching packages:', error);
            this._view.webview.postMessage({
                command: 'searchResults',
                packages: []
            });
        }
    }

    private async _installPackage(pkg: any) {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active project file found');
                return;
            }

            const projectPath = this._findProjectFile(activeEditor.document.uri.fsPath);
            if (!projectPath) {
                vscode.window.showErrorMessage('Could not find project file');
                return;
            }

            // TODO: Implement package installation
            vscode.window.showInformationMessage(`Package installation not yet implemented: ${pkg.id}`);

            // Refresh the installed packages
            await this._updateWebview();
        } catch (error) {
            console.error('Error installing package:', error);
            vscode.window.showErrorMessage(`Failed to install package: ${error}`);
        }
    }

    private async _uninstallPackage(pkg: any) {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active project file found');
                return;
            }

            const projectPath = this._findProjectFile(activeEditor.document.uri.fsPath);
            if (!projectPath) {
                vscode.window.showErrorMessage('Could not find project file');
                return;
            }

            // TODO: Implement package uninstallation
            vscode.window.showInformationMessage(`Package uninstallation not yet implemented: ${pkg.id}`);

            // Refresh the installed packages
            await this._updateWebview();
        } catch (error) {
            console.error('Error uninstalling package:', error);
            vscode.window.showErrorMessage(`Failed to uninstall package: ${error}`);
        }
    }

    private async _getInstalledPackages(): Promise<any[]> {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return [];
            }

            const projectPath = this._findProjectFile(activeEditor.document.uri.fsPath);
            if (!projectPath) {
                return [];
            }

            // TODO: Implement getting installed packages
            return [];
        } catch (error) {
            console.error('Error getting installed packages:', error);
            return [];
        }
    }

    private _findProjectFile(filePath: string): string | undefined {
        let currentDir = path.dirname(filePath);

        while (currentDir !== path.dirname(currentDir)) {
            const possibleProjectFiles = ['*.csproj', '*.vbproj', '*.fsproj'];

            for (const pattern of possibleProjectFiles) {
                const projectFile = path.join(currentDir, pattern);
                if (require('fs').existsSync(projectFile)) {
                    return projectFile;
                }
            }

            currentDir = path.dirname(currentDir);
        }

        return undefined;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri, 'out', 'webview', 'nuget-view', 'bundle.js'
        ));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';">
                <title>NuGet Package Manager</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                        padding: 8px;
                    }

                    .nuget-manager {
                        display: flex;
                        flex-direction: column;
                        height: 100%;
                        gap: 16px;
                    }

                    .search-section {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }

                    .search-controls {
                        display: flex;
                        gap: 8px;
                    }

                    .search-controls input {
                        flex: 1;
                        padding: 6px 8px;
                        background-color: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground);
                        font-size: 12px;
                    }

                    .search-controls button {
                        padding: 6px 12px;
                        background-color: var(--vscode-button-background);
                        border: none;
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        font-size: 12px;
                    }

                    .search-controls button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    .search-controls button:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                    }

                    .search-results, .installed-section {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        overflow: hidden;
                    }

                    .search-results h3, .installed-section h3 {
                        margin: 0;
                        padding: 8px 12px;
                        background-color: var(--vscode-panel-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        font-size: 13px;
                        font-weight: 600;
                    }

                    .package-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 8px 12px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }

                    .package-item:last-child {
                        border-bottom: none;
                    }

                    .package-item:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }

                    .package-info h4 {
                        margin: 0 0 4px 0;
                        font-size: 13px;
                        font-weight: 600;
                    }

                    .package-info p {
                        margin: 0 0 4px 0;
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        line-height: 1.4;
                    }

                    .package-info .version, .package-info .authors {
                        font-size: 10px;
                        color: var(--vscode-descriptionForeground);
                        margin-right: 8px;
                    }

                    .package-item button {
                        padding: 4px 8px;
                        background-color: var(--vscode-button-background);
                        border: none;
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        font-size: 11px;
                        border-radius: 2px;
                    }

                    .package-item button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    .package-item.installed button {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }

                    .package-item.installed button:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground);
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