import { logger } from '../core/logger';
import { WebviewMessage, WebviewConfig, MessageHandler } from '../types/webview';

export class WebviewService {
    private static readonly logger = logger('WebviewService');

    private static messageHandlers: Map<string, MessageHandler[]> = new Map();
    private static messageQueue: Map<string, WebviewMessage[]> = new Map();

    /**
     * Register a message handler for a specific webview instance
     */
    static registerMessageHandler(webviewId: string, handler: MessageHandler): void {
        if (!this.messageHandlers.has(webviewId)) {
            this.messageHandlers.set(webviewId, []);
        }
        this.messageHandlers.get(webviewId)!.push(handler);
    }

    /**
     * Remove all message handlers for a webview instance
     */
    static unregisterMessageHandlers(webviewId: string): void {
        this.messageHandlers.delete(webviewId);
        this.messageQueue.delete(webviewId);
    }

    /**
     * Handle an incoming message from the webview
     */
    static async handleIncomingMessage(webviewId: string, message: WebviewMessage): Promise<void> {
        const handlers = this.messageHandlers.get(webviewId) || [];

        for (const handler of handlers) {
            try {
                await handler(message);
            } catch (error) {
                this.logger.error(`Error handling message ${message.type}:`, error);
            }
        }
    }

    /**
     * Send a message to a webview (queues if webview not ready)
     */
    static sendMessage(webviewId: string, message: WebviewMessage): void {
        // In a pure service, this would be handled by the webview implementation
        // For now, we queue messages that can be picked up by the webview
        if (!this.messageQueue.has(webviewId)) {
            this.messageQueue.set(webviewId, []);
        }
        this.messageQueue.get(webviewId)!.push(message);
    }

    /**
     * Get queued messages for a webview (used by webview to pull messages)
     */
    static getQueuedMessages(webviewId: string): WebviewMessage[] {
        const messages = this.messageQueue.get(webviewId) || [];
        this.messageQueue.set(webviewId, []); // Clear queue after retrieval
        return messages;
    }

    /**
     * Generate CSP (Content Security Policy) for webviews
     */
    static generateCSP(nonce: string): string {
        return `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline'; style-src 'unsafe-inline'; img-src vscode-resource: data:; connect-src https://azuresearch-usnc.nuget.org;`;
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