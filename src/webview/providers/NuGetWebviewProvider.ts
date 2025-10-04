import * as vscode from 'vscode';
import * as path from 'path';
import { PackageBrowseService } from '../../services/nuget/packageBrowseService';
import { IconCacheService } from '../../services/nuget/iconCacheService';
import { logger } from '../../core/logger';
import { NuGetWebview } from './views/NuGetWebview';

const log = logger('NuGetWebviewProvider');

export class NuGetWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-nuget-webview';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext
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
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
                this._extensionContext.globalStorageUri // Allow access to icon cache
            ]
        };

        webviewView.webview.html = NuGetWebview.getHtmlForWebview(this._extensionUri, webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            []
        );

        // Initialize icon cache service
        this._initializeIconCache();

        // Send initial data when webview is ready
        this._updateWebview();
    }

    private async _handleMessage(message: any) {
        // Handle both old (command) and new (type) message formats
        const messageType = message.command || message.type;

        switch (messageType) {
            case 'getNuGetData':
                await this._updateWebview();
                break;

            case 'searchPackages':
                const query = message.query || message.payload?.query;
                if (query) {
                    await this._searchPackages(query);
                }
                break;

            case 'installPackage':
                const installPackage = message.package || message.payload?.package;
                if (installPackage) {
                    await this._installPackage(installPackage);
                }
                break;

            case 'uninstallPackage':
                const uninstallPackage = message.package || message.payload?.package;
                if (uninstallPackage) {
                    await this._uninstallPackage(uninstallPackage);
                }
                break;

            case 'getPackageIcon':
                const { packageId, version } = message.payload || message;
                if (packageId && version && this._view) {
                    await this._getPackageIcon(packageId, version);
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
            log.error('Error updating NuGet webview:', error);
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
            const searchResults = await PackageBrowseService.searchPackages({
                query,
                includePrerelease: false,
                take: 20
            });

            this._view.webview.postMessage({
                command: 'searchResults',
                packages: searchResults || []
            });
        } catch (error) {
            log.error('Error searching packages:', error);
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
            log.error('Error installing package:', error);
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
            log.error('Error uninstalling package:', error);
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
            log.error('Error getting installed packages:', error);
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

    /**
     * Initialize the icon cache service
     */
    private async _initializeIconCache(): Promise<void> {
        try {
            await IconCacheService.initialize(this._extensionContext);
            log.info('Icon cache service initialized');
        } catch (error) {
            log.error('Failed to initialize icon cache service:', error);
        }
    }

    /**
     * Get a package icon and send it to the webview
     */
    private async _getPackageIcon(packageId: string, version: string): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            const iconUri = await IconCacheService.getIconPath(packageId, version, this._view.webview);

            this._view.webview.postMessage({
                command: 'packageIcon',
                packageId,
                version,
                iconUri: iconUri || null
            });
        } catch (error) {
            log.error(`Error getting icon for ${packageId}@${version}:`, error);

            this._view.webview.postMessage({
                command: 'packageIcon',
                packageId,
                version,
                iconUri: null
            });
        }
    }

    public refresh() {
        this._updateWebview();
    }
}