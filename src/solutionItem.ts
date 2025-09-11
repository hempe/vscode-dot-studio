import * as vscode from 'vscode';

export class SolutionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourceUri?: vscode.Uri,
        public readonly itemType?: 'solution' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency' | 'solutionFolder',
        public readonly children?: SolutionItem[],
        public readonly projectPath?: string,
        public readonly solutionPath?: string,
        public readonly dependencyType?: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkAssembly',
        public readonly version?: string
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.resourceUri ? this.resourceUri.fsPath : this.label;
        this.contextValue = itemType;
        
        if (itemType === 'project') {
            // Use specific icon for .csproj files - VS Code's file icon with resource URI should work
            this.iconPath = vscode.ThemeIcon.File;
            this.resourceUri = resourceUri; // Make sure resourceUri is set for proper file icon detection
            // Project file opening will be handled by double-click detection
        } else if (itemType === 'solution') {
            // Use specific icon for .sln files 
            this.iconPath = vscode.ThemeIcon.File;
            this.resourceUri = resourceUri; // Make sure resourceUri is set for proper file icon detection
            // Solution file opening will be handled by double-click detection
        } else if (itemType === 'folder') {
            // Use folder theme icon - try the standard folder icon
            this.iconPath = new vscode.ThemeIcon('folder');
            this.resourceUri = resourceUri;
        } else if (itemType === 'file') {
            // Use ThemeIcon.File which should respect the file extension
            this.iconPath = vscode.ThemeIcon.File;
        } else if (itemType === 'dependencies') {
            this.iconPath = new vscode.ThemeIcon('library');
        } else if (itemType === 'dependency') {
            if (dependencyType === 'PackageReference') {
                this.iconPath = new vscode.ThemeIcon('package');
            } else if (dependencyType === 'ProjectReference') {
                this.iconPath = new vscode.ThemeIcon('project');
            } else if (dependencyType === 'FrameworkAssembly') {
                this.iconPath = new vscode.ThemeIcon('library');
            } else {
                this.iconPath = new vscode.ThemeIcon('references');
            }
        } else if (itemType === 'solutionFolder') {
            // Use a distinctive icon for solution folders (virtual folders in .sln)
            this.iconPath = new vscode.ThemeIcon('folder-library');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        // Add version to tooltip for dependencies
        if (itemType === 'dependency' && version) {
            this.tooltip = `${this.label} (${version})`;
        }

        // Add description only where needed for clarity
        if (itemType === 'file') {
            // Don't add file extension descriptions - let the file icon indicate the type
        } else if (itemType === 'folder') {
            // Don't add description for folders - let the icon speak for itself
        } else if (itemType === 'dependency' && dependencyType) {
            // Show dependency type as description
            if (dependencyType === 'PackageReference') {
                this.description = 'Package';
            } else if (dependencyType === 'ProjectReference') {
                this.description = 'Project';
            } else if (dependencyType === 'FrameworkAssembly') {
                this.description = 'Framework';
            } else {
                this.description = 'Assembly';
            }
        }

        // Set click command for files, projects, and solutions to handle double-click opening
        if (itemType === 'file' || itemType === 'project' || itemType === 'solution') {
            this.command = {
                command: 'dotnet-extension.itemClick',
                title: 'Handle Item Click',
                arguments: [this]
            };
        }
    }
}