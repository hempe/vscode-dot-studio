import * as vscode from 'vscode';

/** Visual Studio's "Show All Files" of the Solution Explorer: remembered per solution, off by default */
export class ShowAllFiles {
    static readonly CONTEXT_KEY = 'shinobi.solutionExplorer.showAllFiles';
    private static readonly STORAGE_KEY = 'showAllFiles';
    private static state: vscode.Memento | undefined;
    private static solutionPath = '';

    static initialize(state: vscode.Memento): void {
        this.state = state;
        this.solutionPath = '';
    }

    /** The solution whose setting applies; also updates the title bar button */
    static setSolution(solutionPath: string): void {
        this.solutionPath = solutionPath;
        void vscode.commands.executeCommand('setContext', this.CONTEXT_KEY, this.isOn());
    }

    static isOn(): boolean {
        return !!this.all()[this.solutionPath];
    }

    static async toggle(): Promise<boolean> {
        // Without a solution there is nothing to remember the setting for
        if (!this.solutionPath) {
            return this.isOn();
        }
        const on = !this.isOn();
        await this.state?.update(this.STORAGE_KEY, { ...this.all(), [this.solutionPath]: on });
        await vscode.commands.executeCommand('setContext', this.CONTEXT_KEY, on);
        return on;
    }

    private static all(): Record<string, boolean> {
        return this.state?.get<Record<string, boolean>>(this.STORAGE_KEY, {}) ?? {};
    }
}
