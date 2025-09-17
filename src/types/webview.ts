export interface WebviewMessage {
    type: string;
    payload?: any;
}

export interface WebviewConfig {
    title: string;
    enableScripts: boolean;
}

export type MessageHandler = (message: WebviewMessage) => Promise<void> | void;

export interface WebviewApi {
    postMessage(message: WebviewMessage): void;
    setState(state: any): void;
    getState(): any;
}