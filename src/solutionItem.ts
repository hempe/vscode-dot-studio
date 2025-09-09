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

        // Only set command for actual files, not containers (solutions, projects, folders)
        if (itemType === 'file' && resourceUri) {
            this.command = {
                command: 'dotnet-extension.openFile',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
    }
}