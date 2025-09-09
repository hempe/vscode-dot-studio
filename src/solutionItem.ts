import * as vscode from 'vscode';

export class SolutionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourceUri?: vscode.Uri,
        public readonly itemType?: 'solution' | 'project' | 'folder' | 'file',
        public readonly children?: SolutionItem[],
        public readonly projectPath?: string,
        public readonly solutionPath?: string
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.resourceUri ? this.resourceUri.fsPath : this.label;
        this.contextValue = itemType;
        
        if (itemType === 'project') {
            this.iconPath = new vscode.ThemeIcon('file-code');
        } else if (itemType === 'solution') {
            this.iconPath = new vscode.ThemeIcon('folder-library');
        } else if (itemType === 'folder') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (itemType === 'file') {
            this.iconPath = vscode.ThemeIcon.File;
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        // Don't set single-click command for files to allow keyboard shortcuts to work
        // Files will open on double-click or Enter key through VS Code's default behavior
    }
}