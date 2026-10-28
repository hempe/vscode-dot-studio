import * as vscode from 'vscode';
import { getNonce } from './nonce';

export class ErrorListWebview {

    public static getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'error-list', 'bundle.js'));
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'codicons', 'codicon.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; form-action 'none'; base-uri 'none';">
    <link href="${codiconsCss}" rel="stylesheet">
    <style>
        body { padding: 0; margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        .toolbar { display: flex; gap: 4px; align-items: center; padding: 4px 8px; position: sticky; top: 0; background: var(--vscode-panel-background); z-index: 2; }
        .toolbar .search { flex: 1; max-width: 360px; margin-left: auto; }
        .toggle { display: inline-flex; gap: 4px; align-items: center; padding: 2px 8px; border: 1px solid transparent; border-radius: 2px;
            background: none; color: inherit; font: inherit; cursor: pointer; opacity: 0.6; }
        .toggle[aria-pressed=true] { opacity: 1; background: var(--vscode-inputOption-activeBackground); border-color: var(--vscode-inputOption-activeBorder, transparent); }
        .toggle:hover { background: var(--vscode-toolbar-hoverBackground); }
        input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
            padding: 3px 6px; font: inherit; border-radius: 2px; width: 100%; box-sizing: border-box; }
        input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        th { text-align: left; font-weight: 600; padding: 3px 6px; position: sticky; top: 31px; background: var(--vscode-panel-background);
            border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; user-select: none; z-index: 1; }
        th .sort { cursor: pointer; }
        th .filter { margin-left: 4px; cursor: pointer; opacity: 0.6; border: none; background: none; color: inherit; padding: 0 2px; }
        th .filter.active { opacity: 1; color: var(--vscode-focusBorder); }
        td { padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        tr.row { cursor: default; }
        tr.row:hover { background: var(--vscode-list-hoverBackground); }
        tr.row:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
        .error { color: var(--vscode-problemsErrorIcon-foreground); }
        .warning { color: var(--vscode-problemsWarningIcon-foreground); }
        .info { color: var(--vscode-problemsInfoIcon-foreground); }
        a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
        a:hover { text-decoration: underline; }
        .menu { position: absolute; z-index: 10; background: var(--vscode-menu-background); color: var(--vscode-menu-foreground);
            border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); padding: 4px 0; max-height: 300px; overflow-y: auto; min-width: 180px;
            box-shadow: 0 2px 8px var(--vscode-widget-shadow); font-weight: normal; }
        .menu label { display: flex; gap: 6px; padding: 2px 10px; cursor: pointer; white-space: nowrap; }
        .menu label:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        .menu hr { border: none; border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); margin: 4px 0; }
        .empty { padding: 12px; opacity: 0.8; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
