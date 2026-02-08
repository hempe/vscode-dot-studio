import * as vscode from 'vscode';
export class SolutionWebView {

    public static getHtmlForWebview(
        extensionUri: vscode.Uri,
        webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'solution-view', 'bundle.js'
        ));

        // Add Codicons CSS for proper VS Code icons
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'codicons', 'codicon.css'
        ));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval'; connect-src https: data:;">
                    <title>Solution Explorer</title>
                    <link rel="stylesheet" type="text/css" href="${codiconsCss}">
                    <style>
                        html, body {
                            margin: 0;
                            padding: 0;
                            height: 100%;
                            width: 100%;
                            overflow: hidden;
                        }
                        body {
                            font-family: var(--vscode-font-family);
                            font-size: var(--vscode-font-size);
                            color: var(--vscode-foreground);
                            background-color: var(--vscode-sideBarTitle-background);
                            margin: 0;
                            padding: 8px;
                            padding-top: 0;
                            height: calc(100vh - 8px);
                            width: calc(100vw - 16px);
                            overflow: hidden;
                        }

                        .solution-explorer {
                            display: flex;
                            flex-direction: column;
                            height: 100%;
                            overflow: hidden;
                        }

                        .solution-tree {
                            outline: none;
                            flex: 1;
                            overflow-y: auto;
                            overflow-x: hidden;
                        }
    
                        .solution-tree:focus,
                        .solution-tree:focus-visible {
                            outline: none;
                            border: none;
                        }
    
                        .header {
                            margin-bottom: 8px;
                            padding-bottom: 8px;
                            border-bottom: 1px solid var(--vscode-panel-border);
                        }
    
                        .framework-selector {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }
    
                        .framework-selector label {
                            font-size: 11px;
                            color: var(--vscode-descriptionForeground);
                        }
    
                        .framework-selector select {
                            background-color: var(--vscode-dropdown-background);
                            border: 1px solid var(--vscode-dropdown-border);
                            color: var(--vscode-dropdown-foreground);
                            padding: 4px 8px;
                            font-size: 11px;
                        }
    
                        .content {
                            flex: 1;
                            overflow: hidden;
                        }
    
                        .tree-node {
                            display: flex;
                            align-items: center;
                            padding: 2px 4px;
                            cursor: pointer;
                            user-select: none;
                            white-space: nowrap;
                        }
    
                        .tree-node:hover {
                            background-color: var(--vscode-list-hoverBackground);
                        }
    
                        .tree-node.selected {
                            background-color: var(--vscode-list-inactiveSelectionBackground);
                            color: var(--vscode-list-inactiveSelectionForeground);
                        }
    
                        .tree-node.focused {
                            outline: 1px solid var(--vscode-focusBorder);
                            outline-offset: -1px;
                        }
    
                        .tree-node.focused.selected {
                            background-color: var(--vscode-list-activeSelectionBackground);
                            color: var(--vscode-list-activeSelectionForeground);
                        }

                        .tree-node.active .node-name {
                            font-weight: bold;
                        }

                        .node-icon {
                            margin-right: 6px;
                            font-size: 16px;
                            width: 16px;
                            height: 16px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                        }
    
                        .node-name {
                            font-size: var(--vscode-font-size);
                        }

                        .node-name.startup-project {
                            font-weight: bold;
                        }
    
                        .expand-icon {
                            margin-right: 4px;
                            font-size: 12px;
                            width: 12px;
                            height: 12px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                        }
    
                        .expand-icon-placeholder {
                            margin-right: 4px;
                            width: 12px;
                            height: 12px;
                            display: inline-block;
                        }
    
                        .context-menu {
                            background-color: var(--vscode-menu-background);
                            border: 1px solid var(--vscode-menu-border);
                            border-radius: 6px;
                            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                            padding: 4px 0;
                            min-width: 220px;
                            font-family: var(--vscode-font-family);
                            font-size: 13px;
                            line-height: 1.4;
                            outline: none;
                        }
    
                        .context-menu:focus {
                            outline: none;
                        }
    
                        .context-menu-content {
                            display: flex;
                            flex-direction: column;
                        }
    
                        .context-menu-item {
                            display: flex;
                            align-items: center;
                            padding: 4px 32px;
                            margin: 0 4px;
                            cursor: pointer;
                            color: var(--vscode-menu-foreground);
                            transition: background-color 0.1s ease;
                            position: relative;
                            min-height: 18px;
                            border-radius: 4px;
                        }
    
                        .context-menu-item:hover {
                            background-color: var(--vscode-menu-selectionBackground);
                            color: var(--vscode-menu-selectionForeground);
                        }
    
                        .context-menu-item:active {
                            background-color: var(--vscode-menu-selectionBackground);
                        }
    
                        .context-menu-item.focused {
                            background-color: var(--vscode-menu-selectionBackground);
                            color: var(--vscode-menu-selectionForeground);
                        }
    
                        .context-menu-icon {
                            margin-right: 12px;
                            width: 16px;
                            height: 16px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            opacity: 0.9;
                        }
    
                        .context-menu-label {
                            flex: 1;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            font-weight: 400;
                        }
    
                        .context-menu-shortcut {
                            margin-left: 24px;
                            color: var(--vscode-menu-foreground);
                            font-size: 12px;
                            opacity: 1;
                            font-weight: 400;
                        }
    
                        .context-menu-separator {
                            height: 1px;
                            background-color: var(--vscode-menu-separatorBackground);
                            margin: 4px 0px;
                        }
    
                        .rename-input {
                            background-color: var(--vscode-input-background);
                            border: 1px solid var(--vscode-input-border);
                            color: var(--vscode-input-foreground);
                            font-family: var(--vscode-font-family);
                            font-size: 12px;
                            padding: 2px 4px;
                            outline: none;
                            border-radius: 2px;
                        }
    
                        .rename-input:focus {
                            border-color: var(--vscode-focusBorder);
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