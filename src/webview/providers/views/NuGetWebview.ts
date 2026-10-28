import * as vscode from 'vscode';
import { getNonce } from './nonce';
export class NuGetWebview {

    /** `includePrerelease`: how "Include prerelease" starts (setting `shinobi.nuget.includePrerelease`) */
    public static getHtmlForWebview(
        extensionUri: vscode.Uri,
        webview: vscode.Webview,
        includePrerelease = false): string {

        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'codicons', 'codicon.css'
        ));

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'nuget-view', 'bundle.js'
        ));

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:; connect-src https://api.nuget.org; form-action 'none'; base-uri 'none';">
    <title>NuGet Package Manager</title>
    <link href="${codiconsCss}" rel="stylesheet">
    <style>
        @keyframes loading-progress {
            0% {
                transform: translateX(-100%);
            }
            100% {
                transform: translateX(calc(100vw + 100%));
            }
        }

        /* vscrui's Dropdown caps both the listbox (200px) and its list (222px) and lets
           both scroll, so long version lists get two scroll bars; let only the listbox scroll */
        .vscrui-dropdown .vscrui-checkbox__listbox ul {
            max-height: none;
            overflow: visible;
        }
    </style>
</head>
<body>
    <div id="root" data-include-prerelease="${includePrerelease}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}