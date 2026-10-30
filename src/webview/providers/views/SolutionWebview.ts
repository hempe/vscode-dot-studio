import * as vscode from 'vscode';
import { getNonce } from './nonce';
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

        const nonce = getNonce();

        return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none';">
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

                        /* The React root: without a height, the explorer's 100% is its content, and a menu opened from the toolbar is cut off at the last row */
                        #root {
                            height: 100%;
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
    
                        /* The scroll bar like VS Code's own lists: thin, a transparent track, the theme's slider colours */
                        .solution-tree::-webkit-scrollbar { width: 10px; height: 10px; }
                        .solution-tree::-webkit-scrollbar-track,
                        .solution-tree::-webkit-scrollbar-corner { background: transparent; }
                        .solution-tree::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }
                        .solution-tree::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
                        .solution-tree::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground); }

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
    
                        /* A flex column with min-height 0, so .solution-tree gets the height that is left and scrolls (with overflow: hidden here
                           the tree was as tall as its rows and the rest was cut off) */
                        .content {
                            flex: 1;
                            min-height: 0;
                            display: flex;
                            flex-direction: column;
                            overflow: auto;
                            padding-block: 6px;
                        }
    
                        .tree-node {
                            display: flex;
                            align-items: center;
                            padding: 2px 4px;
                            cursor: pointer;
                            user-select: none;
                            white-space: nowrap;
                        }
    
                        /* The row under the mouse: a class set by the tree, as Chromium moves :hover to a wrong row after a drop */
                        .tree-node.hovered {
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

                        /* Drag & drop: the row a drop goes into (VS Code's list drop colour) */
                        .tree-node.drop-target {
                            background-color: var(--vscode-list-dropBackground);
                        }

                        /* Unloaded projects, as Visual Studio greys them out */
                        .tree-node.unloaded {
                            opacity: 0.55;
                        }

                        /* Files the project does not contain (Show All Files), as Visual Studio greys them out */
                        .tree-node.excluded {
                            opacity: 0.55;
                        }

                        /* Files the project links from elsewhere: a small link badge at the icon */
                        .tree-node.linked .link-overlay {
                            display: block;
                            position: relative;
                            left: -6px;
                            top: 4px;
                            margin-right: -10px;
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
                            min-width: 0;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }

                        .node-icon,
                        .expand-icon,
                        .expand-icon-placeholder {
                            flex-shrink: 0;
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

                        /* Buttons of the toolbar: hover and keyboard focus like VS Code's action bar */
                        .toolbar-button:hover {
                            background-color: var(--vscode-toolbar-hoverBackground) !important;
                            border-radius: 5px !important;
                        }

                        .toolbar-button:focus-visible {
                            outline: 1px solid var(--vscode-focusBorder);
                            outline-offset: -1px;
                        }

                        .node-name.startup-project {
                            font-weight: bold;
                        }

                        /* Squiggles like the editor's: wavy for errors, warnings and infos */
                        .node-name.diagnostic-error,
                        .node-name.diagnostic-warning,
                        .node-name.diagnostic-info {
                            text-decoration-line: underline;
                            text-decoration-style: wavy;
                            text-decoration-skip-ink: none;
                            text-underline-offset: 2px;
                            /* overflow: hidden (for the ellipsis) clips the wave at the line box: make room below the text */
                            padding-bottom: 6px;
                            margin-bottom: -6px;
                        }

                        .node-name.diagnostic-error {
                            text-decoration-color: var(--vscode-editorError-foreground);
                        }

                        .node-name.diagnostic-warning {
                            text-decoration-color: var(--vscode-editorWarning-foreground);
                        }

                        .node-name.diagnostic-info {
                            text-decoration-color: var(--vscode-editorInfo-foreground);
                        }

                        /* The hint over a marker: fixed to the view, so the tree's scrolling does not clip it */
                        .diagnostics-hint {
                            position: fixed;
                            z-index: 20;
                            background: var(--vscode-editorHoverWidget-background);
                            border: 1px solid var(--vscode-editorHoverWidget-border);
                            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                            padding: 2px 0;
                            max-width: calc(100vw - 16px);
                        }
                        .diagnostics-hint-name { padding: 3px 10px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                        .diagnostics-hint-link {
                            display: block;
                            padding: 1px 10px 3px;
                            border: none;
                            background: none;
                            color: var(--vscode-textLink-foreground);
                            font: inherit;
                            cursor: pointer;
                            text-align: left;
                        }
                        .diagnostics-hint-link:hover { text-decoration: underline; }

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

}