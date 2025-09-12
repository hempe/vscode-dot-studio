import * as vscode from 'vscode';

export interface WebviewPanelConfig {
    viewType: string;
    title: string;
    showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean };
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions;
}

export class WebviewService {
    /**
     * Create a new webview panel with standard configuration
     */
    static createPanel(config: WebviewPanelConfig): vscode.WebviewPanel {
        const defaultOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
        };

        return vscode.window.createWebviewPanel(
            config.viewType,
            config.title,
            config.showOptions,
            { ...defaultOptions, ...config.options }
        );
    }

    /**
     * Set up message handling for a webview panel
     */
    static setupMessageHandling(
        panel: vscode.WebviewPanel,
        messageHandler: (message: any) => Promise<void> | void,
        disposables: vscode.Disposable[]
    ): void {
        panel.webview.onDidReceiveMessage(
            messageHandler,
            undefined,
            disposables
        );
    }

    /**
     * Post a message to a webview
     */
    static postMessage(panel: vscode.WebviewPanel, message: any): Thenable<boolean> {
        return panel.webview.postMessage(message);
    }

    /**
     * Generate CSP (Content Security Policy) for webviews
     */
    static generateCSP(nonce: string): string {
        return `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://azuresearch-usnc.nuget.org;`;
    }

    /**
     * Generate a random nonce for CSP
     */
    static generateNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}