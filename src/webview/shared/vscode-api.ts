import { logger } from '../../core/logger';
import { BackendCmd } from "../../types/commands/backend";

const log = logger('PureWebviewAPI');

export class PureWebviewAPI {

    private messageHandlers: ((message: BackendCmd) => void)[] = [];
    private state: any = {};

    constructor() {
        // Pure webview API - no VS Code dependencies
    }

    public postMessage(message: BackendCmd): void {
        // For pure webview, this could be handled by the service bridge
        // For now, we'll use a message queue approach
        log.info('Webview message:', message);

        // In a real implementation, this would communicate with services
        this.handleServiceMessage(message);
    }

    public setState(state: any): void {
        this.state = { ...this.state, ...state };
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('webview-state', JSON.stringify(this.state));
        }
    }

    public getState(): any {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('webview-state');
            if (saved) {
                this.state = JSON.parse(saved);
            }
        }
        return this.state;
    }

    public onMessage(handler: (message: BackendCmd) => void): void {
        this.messageHandlers.push(handler);
    }

    private handleServiceMessage(message: BackendCmd): void {
        // This would be replaced by actual service communication
        this.messageHandlers.forEach(handler => handler(message));
    }
}

// Backwards compatibility with existing code
export const VSCodeAPI = PureWebviewAPI;