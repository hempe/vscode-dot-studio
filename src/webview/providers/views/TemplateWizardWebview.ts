import * as vscode from 'vscode';

export class TemplateWizardWebview {

    /** The HTML of a form-like editor tab (the template wizards, the Publish tab), running the webview bundle `bundle` */
    public static getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview, title: string, bundle = 'template-wizard'): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', bundle, 'bundle.js'));
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <title>${title.replace(/[<>&"]/g, '')}</title>
    <style>
        body { padding: 0 20px 20px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        #root { max-width: 1200px; }
        h1 { font-size: 1.4em; font-weight: 400; margin: 16px 0; }
        h2 { font-size: 1.1em; font-weight: 600; margin: 4px 0 8px; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
        .toolbar input { flex: 1; }
        input[type=text], select {
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-dropdown-border, transparent));
            padding: 4px 6px; font: inherit; border-radius: 2px; box-sizing: border-box;
        }
        select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
        input[type=text]:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        .layout { display: flex; gap: 16px; min-height: 0; }
        .templates { flex: 1 1 60%; max-height: 55vh; overflow-y: auto; border: 1px solid var(--vscode-panel-border); }
        .details { flex: 1 1 40%; }
        .group { padding: 6px 8px 2px; font-size: 0.85em; text-transform: uppercase; opacity: 0.7; }
        .template { display: block; width: 100%; text-align: left; padding: 6px 8px; border: none; background: none; color: inherit; font: inherit; cursor: pointer; }
        .template:hover { background: var(--vscode-list-hoverBackground); }
        .template[aria-selected=true] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
        .template .meta { opacity: 0.7; font-size: 0.9em; margin-left: 8px; }
        .description { opacity: 0.85; line-height: 1.4; }
        .field { display: grid; grid-template-columns: 160px minmax(0, 1fr); align-items: center; gap: 8px; margin: 8px 0; }
        .field .hint { grid-column: 2; opacity: 0.7; font-size: 0.9em; margin-top: -4px; }
        .check { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; }
        details { margin: 12px 0; }
        summary { cursor: pointer; }
        .buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
        button.action { padding: 5px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; font: inherit; cursor: pointer;
            background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        button.action.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        button.action:disabled { opacity: 0.5; cursor: default; }
        .error { white-space: pre-wrap; color: var(--vscode-errorForeground); border-left: 3px solid var(--vscode-inputValidation-errorBorder); padding: 4px 8px; margin: 12px 0; }
        .empty { padding: 8px; opacity: 0.7; }
        .summary { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 6px 12px; margin: 16px 0; }
        .summary dt { opacity: 0.8; }
        .summary dd { margin: 0; overflow-wrap: anywhere; }
        .status { margin: 8px 0; opacity: 0.9; }
        .status.ok { color: var(--vscode-testing-iconPassed, inherit); }
        .status.failed { color: var(--vscode-errorForeground); }
        .note { opacity: 0.8; line-height: 1.4; }
        .names { list-style: none; margin: 0 0 12px; padding: 0; }
        .names li { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
        .names .name, .names input { flex: 0 1 240px; min-width: 120px; }
        .add-row { align-items: center; }
        .add-row input { flex: 0 1 240px; }
        table.grid { border-collapse: collapse; width: 100%; margin: 8px 0; }
        table.grid th { text-align: left; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        table.grid td { padding: 4px 8px; }
        table.grid tr:hover td { background: var(--vscode-list-hoverBackground); }
        input[type=checkbox]:focus-visible, button.action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
        a.link { color: var(--vscode-textLink-foreground); cursor: pointer; }
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
