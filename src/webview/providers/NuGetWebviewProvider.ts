import * as vscode from 'vscode';
import * as path from 'path';
import { NuGetService } from '../../services/nugetService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';

export class NuGetWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-nuget-webview';
    private readonly logger = logger('NuGetWebviewProvider');

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _nugetService: NuGetService
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

        webviewView.webview.html = NuGetWebview.getHtmlForWebview(this._extensionUri, webviewView.webview);

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
            this.logger.error('Error updating NuGet webview:', error);
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
            this.logger.error('Error searching packages:', error);
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
            this.logger.error('Error installing package:', error);
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
            this.logger.error('Error uninstalling package:', error);
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
            this.logger.error('Error getting installed packages:', error);
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


    public refresh() {
        this._updateWebview();
    }
}