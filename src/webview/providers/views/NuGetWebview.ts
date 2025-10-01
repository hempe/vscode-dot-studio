import * as vscode from 'vscode';
export class NuGetWebview {

    public static getHtmlForWebview(
        extensionUri: vscode.Uri,
        webview: vscode.Webview): string {

        // Add Codicons CSS for proper VS Code icons
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'codicons', 'codicon.css'
        ));

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'nuget-view', 'bundle.js'
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

    private static _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}