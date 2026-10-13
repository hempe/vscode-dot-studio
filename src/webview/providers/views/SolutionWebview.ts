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
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval'; connect-src https: data:;">
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

                        /* Glyphs of font-based icon themes (e.g. Seti) size relative to the text, as in the explorer */
                        .node-icon .theme-glyph {
                            font-size: var(--vscode-font-size);
                            line-height: 1;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            -webkit-font-smoothing: antialiased;
                        }

                        .node-name.startup-project {
                            font-weight: bold;
                        }

                        /* Squiggles like the editor's: wavy for errors and warnings, dotted for infos/suggestions */
                        .node-name.diagnostic-error,
                        .node-name.diagnostic-warning,
                        .node-name.diagnostic-info {
                            text-decoration-line: underline;
                            text-decoration-style: wavy;
                            text-decoration-skip-ink: none;
                            text-underline-offset: 2px;
                        }

                        .node-name.diagnostic-error {
                            text-decoration-color: var(--vscode-editorError-foreground);
                        }

                        .node-name.diagnostic-warning {
                            text-decoration-color: var(--vscode-editorWarning-foreground);
                        }

                        .node-name.diagnostic-info {
                            text-decoration-style: dotted;
                            text-decoration-color: var(--vscode-editorInfo-foreground);
                        }

                        .diagnostic-badge,
                        .diagnostic-dot {
                            margin-left: auto;
                            padding-left: 8px;
                            margin-right: 8px;
                            flex-shrink: 0;
                        }

                        .diagnostic-badge {
                            font-size: 11px;
                        }

                        .diagnostic-dot {
                            width: 6px;
                            height: 6px;
                            padding-left: 0;
                            border-radius: 50%;
                            background-color: currentColor;
                        }

                        .diagnostic-badge.diagnostic-error,
                        .diagnostic-dot.diagnostic-error {
                            color: var(--vscode-editorError-foreground);
                        }

                        .diagnostic-badge.diagnostic-warning,
                        .diagnostic-dot.diagnostic-warning {
                            color: var(--vscode-editorWarning-foreground);
                        }

                        .diagnostic-badge.diagnostic-info,
                        .diagnostic-dot.diagnostic-info {
                            color: var(--vscode-editorInfo-foreground);
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