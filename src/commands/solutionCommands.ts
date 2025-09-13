import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, ErrorUtils, InputUtils } from '../utils';
import { NuGetService, NuGetSearchOptions } from '../services/nugetService';
import { TerminalService } from '../services/terminalService';
import { WebviewService } from '../services/webviewService';
import { PackageDiscoveryService, InstalledPackage, ProjectPackageInfo } from '../services/packageDiscoveryService';
import { PackageUpdateService, PackageUpdate } from '../services/packageUpdateService';
import { PackageConsolidationService, PackageConflict, ConsolidationSummary } from '../services/packageConsolidationService';

export class SolutionCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider
    ) {}

    public registerCommands(): void {
        this.registerCommand('refreshSolution', this.refreshSolution.bind(this));
        this.registerCommand('renameSolution', this.renameSolution.bind(this));
        this.registerCommand('newProject', this.newProject.bind(this));
        this.registerCommand('addExistingProject', this.addExistingProject.bind(this));
        this.registerCommand('newSolutionFolder', this.newSolutionFolder.bind(this));
        this.registerCommand('buildSolution', this.buildSolution.bind(this));
        this.registerCommand('rebuildSolution', this.rebuildSolution.bind(this));
        this.registerCommand('cleanSolution', this.cleanSolution.bind(this));
        this.registerCommand('manageSolutionNugetPackages', this.manageSolutionNugetPackages.bind(this));
    }

    private registerCommand(commandName: string, callback: (...args: any[]) => any): void {
        const command = vscode.commands.registerCommand(`dotnet-extension.${commandName}`, callback);
        this.context.subscriptions.push(command);
    }

    private refreshSolution(): void {
        this.solutionProvider.refresh();
    }

    private async renameSolution(item: any): Promise<void> {
        const solutionPath = PathUtils.getPathFromItem(item, 'rename solution');
        if (!solutionPath) return;

        const currentName = path.basename(solutionPath, '.sln');
        
        const newName = await InputUtils.showInputBox(
            `Rename solution "${currentName}"`,
            currentName,
            ValidationUtils.createNameValidator('Solution', false)
        );

        if (newName && newName !== currentName) {
            try {
                const fs = require('fs');
                const solutionDir = path.dirname(solutionPath);
                const newSolutionPath = path.join(solutionDir, `${newName}.sln`);
                
                // Check if new name already exists
                if (fs.existsSync(newSolutionPath)) {
                    ErrorUtils.showError(`A solution named "${newName}" already exists`);
                    return;
                }
                
                await fs.promises.rename(solutionPath, newSolutionPath);
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed solution to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError(`Failed to rename solution`, error);
            }
        }
    }

    private async newProject(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.resourceUri.fsPath;
        const solutionDir = path.dirname(solutionPath);

        // Show project template selection
        const templates = [
            { label: 'Console Application', value: 'console' },
            { label: 'Class Library', value: 'classlib' },
            { label: 'Web API', value: 'webapi' },
            { label: 'MVC Web Application', value: 'mvc' },
            { label: 'Blazor WebAssembly', value: 'blazorwasm' },
            { label: 'Blazor Server', value: 'blazorserver' },
            { label: 'WPF Application', value: 'wpf' },
            { label: 'WinForms Application', value: 'winforms' },
            { label: 'xUnit Test Project', value: 'xunit' },
            { label: 'NUnit Test Project', value: 'nunit' },
            { label: 'MSTest Test Project', value: 'mstest' }
        ];

        const selectedTemplate = await InputUtils.showQuickPick(
            templates,
            'Select project template'
        );

        if (!selectedTemplate || Array.isArray(selectedTemplate)) return;

        const projectName = await InputUtils.showInputBox(
            'Enter project name',
            undefined,
            ValidationUtils.createNameValidator('Project', false)
        );

        if (!projectName) return;

        try {
            const projectDir = path.join(solutionDir, projectName);
            
            // Create project using dotnet CLI
            const terminal = vscode.window.createTerminal({
                name: 'New Project',
                cwd: solutionDir
            });

            terminal.sendText(`dotnet new ${selectedTemplate.value} -n "${projectName}" -o "${projectName}"`);
            terminal.sendText(`dotnet sln add "${projectName}/${projectName}.csproj"`);
            terminal.show();
            
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Created new ${selectedTemplate.label}: ${projectName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create new project', error);
        }
    }

    private async addExistingProject(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.resourceUri.fsPath;
        const solutionDir = path.dirname(solutionPath);

        const projectFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: {
                'Project Files': ['csproj', 'vbproj', 'fsproj']
            },
            defaultUri: vscode.Uri.file(solutionDir)
        });

        if (!projectFiles || projectFiles.length === 0) {
            return;
        }

        try {
            for (const projectFile of projectFiles) {
                const success = await this.solutionProvider.addProjectToSolution(solutionPath, projectFile.fsPath);
                if (success) {
                    const projectName = PathUtils.getProjectName(projectFile.fsPath);
                    vscode.window.showInformationMessage(`Added project: ${projectName}`);
                }
            }
        } catch (error) {
            ErrorUtils.showError('Failed to add project to solution', error);
        }
    }

    private async newSolutionFolder(item: any): Promise<void> {
        let solutionPath: string | undefined;
        
        // If item has solutionPath (solution folder or solution item), use it
        if (item?.solutionPath) {
            solutionPath = item.solutionPath;
        } else {
            // Otherwise, search for solution file
            solutionPath = await this.getSolutionPath(item, 'create solution folder');
        }
        
        if (!solutionPath) {
            ErrorUtils.showError('Cannot find solution file');
            return;
        }
        
        const solutionName = path.basename(solutionPath, '.sln');
        
        const folderName = await InputUtils.showInputBox(
            `Create new solution folder in "${solutionName}"`,
            'New Solution Folder',
            ValidationUtils.createNameValidator('Solution folder')
        );

        if (!folderName) return;

        try {
            const fs = require('fs');
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            
            // Generate GUID for new solution folder
            const folderGuid = '{' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }).toUpperCase() + '}';
            
            // Insert solution folder entry
            let folderEntry = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${folderName}", "${folderName}", "${folderGuid}"\nEndProject`;
            
            // If creating under a parent folder, add nesting information
            let nestedStructure = '';
            if (item && item.contextValue === 'solutionFolder' && item.id) {
                const parentGuid = item.id; // Solution folder ID is its GUID
                nestedStructure = `\n\tGlobalSection(NestedProjects) = preSolution\n\t\t${folderGuid} = ${parentGuid}\n\tEndGlobalSection`;
            }
            
            // Find a good insertion point (after last Project entry)
            const lines = solutionContent.split('\n');
            let insertIndex = -1;
            
            for (let i = lines.length - 1; i >= 0; i--) {
                const line: string = lines[i];
                if (line.trim() === 'EndProject') {
                    insertIndex = i + 1;
                    break;
                }
            }
            
            if (insertIndex === -1) {
                // Fallback: insert before Global section
                insertIndex = lines.findIndex((line: string) => line.trim() === 'Global');
                if (insertIndex === -1) {
                    insertIndex = lines.length;
                }
            }
            
            lines.splice(insertIndex, 0, folderEntry);
            
            // Handle nesting in Global section if needed
            if (nestedStructure) {
                const globalIndex = lines.findIndex((line: string) => line.trim() === 'Global');
                if (globalIndex !== -1) {
                    // Check if NestedProjects already exists
                    let nestedIndex = -1;
                    for (let i = globalIndex; i < lines.length; i++) {
                        if (lines[i].includes('GlobalSection(NestedProjects)')) {
                            nestedIndex = i;
                            break;
                        }
                        if (lines[i].trim() === 'EndGlobal') {
                            break;
                        }
                    }
                    
                    if (nestedIndex !== -1) {
                        // Add to existing NestedProjects section
                        const endSectionIndex = lines.findIndex((line: string, index: number) => 
                            index > nestedIndex && line.trim() === 'EndGlobalSection'
                        );
                        if (endSectionIndex !== -1) {
                            lines.splice(endSectionIndex, 0, `\t\t${folderGuid} = ${item.id}`);
                        }
                    } else {
                        // Insert new NestedProjects section before EndGlobal
                        const endGlobalIndex = lines.findIndex((line: string, index: number) => 
                            index > globalIndex && line.trim() === 'EndGlobal'
                        );
                        if (endGlobalIndex !== -1) {
                            lines.splice(endGlobalIndex, 0, 
                                '\tGlobalSection(NestedProjects) = preSolution',
                                `\t\t${folderGuid} = ${item.id}`,
                                '\tEndGlobalSection'
                            );
                        }
                    }
                }
            }
            
            const updatedContent = lines.join('\n');
            
            await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Created solution folder: ${folderName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create solution folder', error);
        }
    }

    private async buildSolution(item?: any): Promise<void> {
        const solutionPath = await this.getSolutionPath(item, 'build solution');
        if (!solutionPath) return;

        try {
            await TerminalService.buildSolution(solutionPath);
            const solutionName = path.basename(solutionPath, '.sln');
            vscode.window.showInformationMessage(`Building solution: ${solutionName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to build solution', error);
        }
    }

    private async rebuildSolution(item?: any): Promise<void> {
        const solutionPath = await this.getSolutionPath(item, 'rebuild solution');
        if (!solutionPath) return;

        try {
            await TerminalService.rebuildSolution(solutionPath);
            const solutionName = path.basename(solutionPath, '.sln');
            vscode.window.showInformationMessage(`Rebuilding solution: ${solutionName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to rebuild solution', error);
        }
    }

    private async cleanSolution(item?: any): Promise<void> {
        const solutionPath = await this.getSolutionPath(item, 'clean solution');
        if (!solutionPath) return;

        try {
            await TerminalService.cleanSolution(solutionPath);
            const solutionName = path.basename(solutionPath, '.sln');
            vscode.window.showInformationMessage(`Cleaning solution: ${solutionName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to clean solution', error);
        }
    }

    private async manageSolutionNugetPackages(item: any): Promise<void> {
        const solutionPath = PathUtils.getPathFromItem(item, 'manage NuGet packages');
        if (!solutionPath) return;

        const solutionName = path.basename(solutionPath, '.sln');

        // Create webview panel using the service
        const panel = WebviewService.createPanel({
            viewType: 'solutionNugetManager',
            title: `Manage NuGet Packages - ${solutionName}`,
            showOptions: vscode.ViewColumn.One
        });

        // Set up message handling
        WebviewService.setupMessageHandling(
            panel,
            async (message) => await this.handleNugetWebviewMessage(message, solutionPath, panel),
            this.context.subscriptions
        );

        // Set the HTML content
        panel.webview.html = this.getImprovedNugetManagerHtml(solutionName);
    }

    private async handleNugetWebviewMessage(message: any, solutionPath: string, panel: vscode.WebviewPanel): Promise<void> {
        try {
            switch (message.type) {
                case 'searchPackages':
                    const results = await this.searchNuGetPackages(message.query, message.includePrerelease);
                    await WebviewService.postMessage(panel, {
                        type: 'searchResults',
                        results: results,
                        query: message.query
                    });
                    break;
                case 'installPackage':
                    await this.installPackage(solutionPath, message.packageId, message.version);
                    break;
                case 'loadInstalledPackages':
                    const installedPackages = await this.getInstalledPackages(solutionPath);
                    await WebviewService.postMessage(panel, {
                        type: 'installedPackages',
                        packages: installedPackages
                    });
                    break;
                case 'removePackage':
                    await this.removePackage(solutionPath, message.packageId, message.projectPath);
                    break;
                case 'loadProjectPackageInfo':
                    const projectInfo = await this.getProjectPackageInfo(solutionPath);
                    await WebviewService.postMessage(panel, {
                        type: 'projectPackageInfo',
                        projects: projectInfo
                    });
                    break;
                case 'checkForUpdates':
                    const updates = await this.checkForUpdates(solutionPath, message.includePrerelease || false);
                    await WebviewService.postMessage(panel, {
                        type: 'packageUpdates',
                        updates: updates
                    });
                    break;
                case 'updatePackage':
                    await this.updatePackage(solutionPath, message.packageId, message.version, message.projectPath);
                    break;
                case 'analyzeConflicts':
                    const conflicts = await this.analyzePackageConflicts(solutionPath);
                    const summary = await this.getConsolidationSummary(solutionPath);
                    await WebviewService.postMessage(panel, {
                        type: 'packageConflicts',
                        conflicts: conflicts,
                        summary: summary
                    });
                    break;
                case 'consolidatePackage':
                    await this.consolidatePackageVersions(solutionPath, message.packageId, message.targetVersion);
                    break;
                default:
                    console.warn('Unknown webview message type:', message.type);
            }
        } catch (error) {
            ErrorUtils.showError('NuGet operation failed', error);
        }
    }

    private async getSolutionPath(item?: any, actionName?: string): Promise<string | undefined> {
        // If item is provided, try to get path from it
        if (item) {
            return PathUtils.getPathFromItem(item, actionName || 'solution operation') || undefined;
        }

        // Otherwise, search for solution files in the workspace
        try {
            const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
            
            if (solutionFiles.length === 0) {
                ErrorUtils.showError('No solution file found in workspace');
                return undefined;
            }

            if (solutionFiles.length === 1) {
                // Single solution - use it automatically
                return solutionFiles[0].fsPath;
            }

            // Multiple solutions - let user choose
            const options = solutionFiles.map(sln => ({
                label: path.basename(sln.fsPath, '.sln'),
                description: path.dirname(sln.fsPath),
                value: sln.fsPath
            }));

            const selected = await InputUtils.showQuickPick(options, 'Select solution to build');
            return Array.isArray(selected) ? undefined : selected?.value;
            
        } catch (error) {
            ErrorUtils.showError('Failed to find solution file', error);
            return undefined;
        }
    }

    private async searchNuGetPackages(query: string, includePrerelease: boolean = false): Promise<any[]> {
        try {
            const searchOptions: NuGetSearchOptions = {
                query,
                includePrerelease,
                take: 20
            };
            
            return await NuGetService.searchPackages(searchOptions);
        } catch (error) {
            console.error('Error searching NuGet packages:', error);
            // Return empty array instead of throwing to maintain UI stability
            return [];
        }
    }

    private async getInstalledPackages(solutionPath: string): Promise<InstalledPackage[]> {
        try {
            return await PackageDiscoveryService.discoverInstalledPackages(solutionPath);
        } catch (error) {
            console.error('Error getting installed packages:', error);
            return [];
        }
    }

    private async getProjectPackageInfo(solutionPath: string): Promise<ProjectPackageInfo[]> {
        try {
            return await PackageDiscoveryService.getProjectPackageInfo(solutionPath);
        } catch (error) {
            console.error('Error getting project package info:', error);
            return [];
        }
    }

    private async removePackage(solutionPath: string, packageId: string, projectPath?: string): Promise<void> {
        // Validate inputs
        if (!NuGetService.validatePackageId(packageId)) {
            ErrorUtils.showError('Invalid package ID format');
            return;
        }

        try {
            if (projectPath) {
                // Remove from specific project
                await TerminalService.removePackage(projectPath, packageId);
                const projectName = path.basename(projectPath, '.csproj');
                vscode.window.showInformationMessage(`Removed ${packageId} from project: ${projectName}`);
            } else {
                // Remove from all projects in solution
                const projectInfo = await this.getProjectPackageInfo(solutionPath);
                const projectsWithPackage = projectInfo.filter(project => 
                    project.packages.some(pkg => pkg.id === packageId)
                );

                for (const project of projectsWithPackage) {
                    await TerminalService.removePackage(project.projectPath, packageId);
                }

                const solutionName = path.basename(solutionPath, '.sln');
                vscode.window.showInformationMessage(`Removed ${packageId} from solution: ${solutionName}`);
            }
        } catch (error) {
            ErrorUtils.showError('Failed to remove package', error);
        }
    }

    private async checkForUpdates(solutionPath: string, includePrerelease: boolean = false): Promise<PackageUpdate[]> {
        try {
            return await PackageUpdateService.checkForUpdates(solutionPath, {
                includePrerelease,
                batchSize: 3 // Smaller batch size for responsiveness
            });
        } catch (error) {
            console.error('Error checking for updates:', error);
            return [];
        }
    }

    private async updatePackage(solutionPath: string, packageId: string, version: string, projectPath?: string): Promise<void> {
        // Validate inputs
        if (!NuGetService.validatePackageId(packageId)) {
            ErrorUtils.showError('Invalid package ID format');
            return;
        }

        if (!NuGetService.validateVersion(version)) {
            ErrorUtils.showError('Invalid version format');
            return;
        }

        try {
            if (projectPath) {
                // Update specific project
                await TerminalService.updatePackage(projectPath, packageId, version);
                const projectName = path.basename(projectPath, '.csproj');
                vscode.window.showInformationMessage(`Updating ${packageId} to ${version} in project: ${projectName}`);
            } else {
                // Update all projects in solution that have the package
                const projectInfo = await this.getProjectPackageInfo(solutionPath);
                const projectsWithPackage = projectInfo.filter(project => 
                    project.packages.some(pkg => pkg.id === packageId)
                );

                for (const project of projectsWithPackage) {
                    await TerminalService.updatePackage(project.projectPath, packageId, version);
                }

                const solutionName = path.basename(solutionPath, '.sln');
                vscode.window.showInformationMessage(`Updating ${packageId} to ${version} in solution: ${solutionName}`);
            }
        } catch (error) {
            ErrorUtils.showError('Failed to update package', error);
        }
    }

    private async analyzePackageConflicts(solutionPath: string): Promise<PackageConflict[]> {
        try {
            return await PackageConsolidationService.analyzePackageConflicts(solutionPath);
        } catch (error) {
            console.error('Error analyzing package conflicts:', error);
            return [];
        }
    }

    private async getConsolidationSummary(solutionPath: string): Promise<ConsolidationSummary> {
        try {
            return await PackageConsolidationService.getConsolidationSummary(solutionPath);
        } catch (error) {
            console.error('Error getting consolidation summary:', error);
            return {
                totalPackages: 0,
                conflictedPackages: 0,
                totalProjects: 0,
                conflictSeverity: { high: 0, medium: 0, low: 0 }
            };
        }
    }

    private async consolidatePackageVersions(solutionPath: string, packageId: string, targetVersion: string): Promise<void> {
        // Validate inputs
        if (!NuGetService.validatePackageId(packageId)) {
            ErrorUtils.showError('Invalid package ID format');
            return;
        }

        if (!NuGetService.validateVersion(targetVersion)) {
            ErrorUtils.showError('Invalid target version format');
            return;
        }

        try {
            // Get current conflicts to determine what needs updating
            const conflicts = await this.analyzePackageConflicts(solutionPath);
            const conflict = conflicts.find(c => c.packageId === packageId);
            
            if (!conflict) {
                ErrorUtils.showError(`No conflicts found for package ${packageId}`);
                return;
            }

            // Generate consolidation plan
            const plan = PackageConsolidationService.generateConsolidationPlan(conflict);
            
            let updatedCount = 0;
            
            for (const project of plan.projectsToUpdate) {
                try {
                    await TerminalService.updatePackage(project.projectPath, packageId, targetVersion);
                    updatedCount++;
                } catch (error) {
                    console.error(`Failed to update ${packageId} in ${project.projectName}:`, error);
                    // Continue with other projects even if one fails
                }
            }

            const solutionName = path.basename(solutionPath, '.sln');
            
            if (updatedCount === plan.projectsToUpdate.length) {
                vscode.window.showInformationMessage(`Successfully consolidated ${packageId} to ${targetVersion} across ${updatedCount} projects in ${solutionName}`);
            } else if (updatedCount > 0) {
                vscode.window.showWarningMessage(`Partially consolidated ${packageId}: ${updatedCount}/${plan.projectsToUpdate.length} projects updated in ${solutionName}`);
            } else {
                ErrorUtils.showError(`Failed to consolidate ${packageId} in any projects`);
            }
        } catch (error) {
            ErrorUtils.showError('Failed to consolidate package', error);
        }
    }

    private async installPackage(solutionPath: string, packageId: string, version?: string): Promise<void> {
        // Validate inputs
        if (!NuGetService.validatePackageId(packageId)) {
            ErrorUtils.showError('Invalid package ID format');
            return;
        }

        if (version && !NuGetService.validateVersion(version)) {
            ErrorUtils.showError('Invalid version format');
            return;
        }

        try {
            await TerminalService.installPackage(solutionPath, packageId, version);
            const solutionName = path.basename(solutionPath, '.sln');
            vscode.window.showInformationMessage(`Installing ${packageId} in solution: ${solutionName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to install package', error);
        }
    }

    private getNugetManagerHtml(solutionName: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NuGet Package Manager</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.39/dist/codicon.css">
    <script type="module" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit@1.4.0/dist/toolkit.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            background-color: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 12px 20px;
            flex-shrink: 0;
        }

        .header h1 {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .header .solution-name {
            font-size: 13px;
            opacity: 0.8;
        }

        .content-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        vscode-panels {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        vscode-panel-view {
            display: flex;
            flex-direction: column;
            padding: 20px;
            overflow-y: auto;
        }

        .filter-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 16px;
            align-items: center;
        }

        .search-container {
            margin-bottom: 20px;
        }

        .search-field {
            width: 100%;
        }

        .package-list {
            flex: 1;
            background-color: var(--vscode-list-activeSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow-y: auto;
            min-height: 200px;
        }

        .package-item {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .package-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .package-item:last-child {
            border-bottom: none;
        }

        .package-name {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 4px;
        }

        .package-description {
            font-size: 12px;
            opacity: 0.8;
            margin-bottom: 8px;
        }

        .package-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            opacity: 0.7;
        }

        .package-version {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
        }

        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            opacity: 0.6;
            padding: 40px 20px;
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .stats-bar {
            padding: 12px 20px;
            background-color: var(--vscode-statusBar-background);
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            flex-shrink: 0;
        }

        .action-buttons {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .loading-container {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
        }

        .codicon-spin {
            animation: codicon-spin 1.5s steps(30) infinite;
        }

        @keyframes codicon-spin {
            to { transform: rotate(360deg); }
        }

        vscode-dropdown {
            min-width: 180px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Manage NuGet Packages for Solution</h1>
        <div class="solution-name">Solution: ${solutionName}</div>
    </div>

    <div class="content-container">
        <vscode-panels id="nuget-panels" activeid="tab-browse" aria-label="NuGet Package Manager">
            <!-- Tab Headers -->
            <vscode-panel-tab id="tab-browse">
                <span class="codicon codicon-search"></span>
                Browse
            </vscode-panel-tab>
            <vscode-panel-tab id="tab-installed">
                <span class="codicon codicon-package"></span>
                Installed
            </vscode-panel-tab>
            <vscode-panel-tab id="tab-updates">
                <span class="codicon codicon-cloud-download"></span>
                Updates
            </vscode-panel-tab>
            <vscode-panel-tab id="tab-consolidate">
                <span class="codicon codicon-filter"></span>
                Consolidate
            </vscode-panel-tab>

            <!-- Browse Panel -->
            <vscode-panel-view id="view-browse">
                <div class="filter-bar">
                    <vscode-dropdown id="package-source">
                        <vscode-option value="nuget.org">Package source: nuget.org</vscode-option>
                        <vscode-option value="all">Package source: All</vscode-option>
                    </vscode-dropdown>
                    <vscode-dropdown id="include-prerelease">
                        <vscode-option value="false">Include prerelease: No</vscode-option>
                        <vscode-option value="true">Include prerelease: Yes</vscode-option>
                    </vscode-dropdown>
                </div>
                <div class="search-container">
                    <vscode-text-field
                        class="search-field"
                        placeholder="Search packages..."
                        id="browse-search">
                        <span slot="start" class="codicon codicon-search"></span>
                    </vscode-text-field>
                </div>
                <div class="package-list" id="browse-list">
                    <div class="empty-state">
                        <span class="codicon codicon-search empty-icon"></span>
                        <h3>Search for packages</h3>
                        <p>Enter a search term to find NuGet packages</p>
                    </div>
                </div>
            </vscode-panel-view>

            <!-- Installed Panel -->
            <vscode-panel-view id="view-installed">
                <div class="search-container">
                    <vscode-text-field
                        class="search-field"
                        placeholder="Search installed packages..."
                        id="installed-search">
                        <span slot="start" class="codicon codicon-search"></span>
                    </vscode-text-field>
                </div>
                <div class="package-list" id="installed-list">
                    <div class="empty-state">
                        <span class="codicon codicon-package empty-icon"></span>
                        <h3>No packages installed</h3>
                        <p>Install packages from the Browse tab</p>
                    </div>
                </div>
            </vscode-panel-view>

            <!-- Updates Panel -->
            <vscode-panel-view id="view-updates">
                <div class="package-list" id="updates-list">
                    <div class="empty-state">
                        <span class="codicon codicon-cloud-download empty-icon"></span>
                        <h3>All packages are up to date</h3>
                        <p>No updates available for installed packages</p>
                    </div>
                </div>
            </vscode-panel-view>

            <!-- Consolidate Panel -->
            <vscode-panel-view id="view-consolidate">
                <div class="package-list" id="consolidate-list">
                    <div class="empty-state">
                        <span class="codicon codicon-check empty-icon"></span>
                        <h3>No version conflicts</h3>
                        <p>All packages have consistent versions across projects</p>
                    </div>
                </div>
            </vscode-panel-view>
        </vscode-panels>
    </div>
    
    <div class="stats-bar">
        <span>Package sources: nuget.org</span>
        <span>Ready</span>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let searchTimeout;
        let currentQuery = '';
        let includePrerelease = false;

        // Initialize event listeners after DOM is loaded
        document.addEventListener('DOMContentLoaded', function() {
            // Listen for panel tab changes
            const panels = document.getElementById('nuget-panels');
            panels.addEventListener('change', function(e) {
                const activeTabId = e.target.activeid;
                handleTabChange(activeTabId);
            });

            // Initialize search inputs
            setupSearchInputs();

            // Initialize dropdowns
            setupDropdowns();
        });

        function handleTabChange(activeTabId) {
            switch(activeTabId) {
                case 'tab-installed':
                    loadInstalledPackages();
                    break;
                case 'tab-updates':
                    loadUpdates();
                    break;
                case 'tab-consolidate':
                    loadConsolidation();
                    break;
            }
        }

        function setupSearchInputs() {
            // Browse search
            const browseSearch = document.getElementById('browse-search');
            browseSearch.addEventListener('input', function(e) {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    performSearch(e.target.value);
                }, 500);
            });

            // Installed search (client-side filtering)
            const installedSearch = document.getElementById('installed-search');
            installedSearch.addEventListener('input', function(e) {
                filterInstalledPackages(e.target.value);
            });
        }

        function setupDropdowns() {
            // Package source dropdown
            const packageSource = document.getElementById('package-source');
            packageSource.addEventListener('change', function(e) {
                // Handle package source change
                if (currentQuery) {
                    performSearch(currentQuery);
                }
            });

            // Include prerelease dropdown
            const prereleaseDropdown = document.getElementById('include-prerelease');
            prereleaseDropdown.addEventListener('change', function(e) {
                includePrerelease = e.target.value === 'true';
                if (currentQuery) {
                    performSearch(currentQuery);
                }
            });
        }
        
        function loadInstalledPackages() {
            const packageList = document.getElementById('installed-list');
            packageList.innerHTML = \`
                <div class="loading-container">
                    <span class="codicon codicon-loading codicon-spin"></span>
                    <span>Loading installed packages...</span>
                </div>
            \`;

            vscode.postMessage({
                type: 'loadInstalledPackages'
            });
        }
        
        function displayInstalledPackages(packages) {
            const packageList = document.getElementById('installed-list');

            if (!packages || packages.length === 0) {
                packageList.innerHTML = \`
                    <div class="empty-state">
                        <span class="codicon codicon-package empty-icon"></span>
                        <h3>No packages installed</h3>
                        <p>Install packages from the Browse tab</p>
                    </div>
                \`;
                return;
            }

            // Group packages by ID (show all versions and projects)
            const packageGroups = {};
            packages.forEach(pkg => {
                if (!packageGroups[pkg.id]) {
                    packageGroups[pkg.id] = [];
                }
                packageGroups[pkg.id].push(pkg);
            });

            const packageItems = Object.keys(packageGroups).map(packageId => {
                const versions = packageGroups[packageId];
                const projectList = versions.map(v => \`\${v.projectName} (\${v.version})\`).join(', ');

                return \`
                    <div class="package-item" data-package-id="\${packageId}">
                        <div class="package-name">\${packageId}</div>
                        <div class="package-description">Used in: \${projectList}</div>
                        <div class="package-meta">
                            <span>Projects: \${versions.length}</span>
                            <div class="action-buttons">
                                <vscode-button appearance="secondary" onclick="removePackage('\${packageId}')">
                                    <span slot="start" class="codicon codicon-remove"></span>
                                    Remove
                                </vscode-button>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');

            packageList.innerHTML = packageItems;
        }

        function filterInstalledPackages(searchTerm) {
            const packageItems = document.querySelectorAll('#installed-list .package-item');
            const lowerSearch = searchTerm.toLowerCase();

            packageItems.forEach(item => {
                const packageName = item.querySelector('.package-name').textContent.toLowerCase();
                const packageDesc = item.querySelector('.package-description').textContent.toLowerCase();
                const matches = packageName.includes(lowerSearch) || packageDesc.includes(lowerSearch);
                item.style.display = matches ? 'block' : 'none';
            });
        }
        
        function removePackage(packageId) {
            const confirmed = confirm(\`Remove \${packageId} from all projects?\\n\\nThis will remove the package from all projects in the solution.\`);
            if (confirmed) {
                vscode.postMessage({
                    type: 'removePackage',
                    packageId: packageId
                });
                
                // Reload installed packages after removal
                setTimeout(() => {
                    loadInstalledPackages();
                }, 2000);
            }
        }
        
        function loadUpdates() {
            const packageList = document.getElementById('updates-list');
            packageList.innerHTML = \`
                <div class="loading-container">
                    <span class="codicon codicon-loading codicon-spin"></span>
                    <span>Checking for updates...</span>
                </div>
            \`;

            vscode.postMessage({
                type: 'checkForUpdates',
                includePrerelease: includePrerelease
            });
        }
        
        function displayPackageUpdates(updates) {
            const packageList = document.getElementById('updates-list');

            if (!updates || updates.length === 0) {
                packageList.innerHTML = \`
                    <div class="empty-state">
                        <span class="codicon codicon-check empty-icon"></span>
                        <h3>All packages are up to date</h3>
                        <p>No updates available for installed packages</p>
                    </div>
                \`;
                return;
            }

            const updateItems = updates.map(update => {
                const projectList = update.projects.join(', ');
                const isPrerelease = update.isPrerelease ? ' (Prerelease)' : '';

                return \`
                    <div class="package-item">
                        <div class="package-name">\${update.id}\${isPrerelease}</div>
                        <div class="package-description">Used in: \${projectList}</div>
                        <div class="package-meta">
                            <span>Current: \${update.currentVersion} → Latest: \${update.latestVersion}</span>
                            <div class="action-buttons">
                                <vscode-button appearance="primary" onclick="updatePackage('\${update.id}', '\${update.latestVersion}')">
                                    <span slot="start" class="codicon codicon-cloud-download"></span>
                                    Update
                                </vscode-button>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');

            packageList.innerHTML = updateItems;
        }
        
        function updatePackage(packageId, version) {
            const confirmed = confirm(\`Update \${packageId} to version \${version}?\\n\\nThis will update the package in all projects that use it.\`);
            if (confirmed) {
                vscode.postMessage({
                    type: 'updatePackage',
                    packageId: packageId,
                    version: version
                });
                
                // Reload updates after update
                setTimeout(() => {
                    loadUpdates();
                }, 3000);
            }
        }
        
        function loadConsolidation() {
            const packageList = document.getElementById('consolidate-list');
            packageList.innerHTML = \`
                <div class="loading-container">
                    <span class="codicon codicon-loading codicon-spin"></span>
                    <span>Analyzing package conflicts...</span>
                </div>
            \`;

            vscode.postMessage({
                type: 'analyzeConflicts'
            });
        }
        
        function displayPackageConflicts(conflicts, summary) {
            const packageList = document.getElementById('consolidate-list');

            if (!conflicts || conflicts.length === 0) {
                packageList.innerHTML = \`
                    <div class="empty-state">
                        <span class="codicon codicon-check empty-icon"></span>
                        <h3>No version conflicts</h3>
                        <p>All packages have consistent versions across projects</p>
                        \${summary ? \`<div style="margin-top: 16px; font-size: 12px; opacity: 0.8;">
                            \${summary.totalPackages} packages across \${summary.totalProjects} projects analyzed
                        </div>\` : ''}
                    </div>
                \`;
                return;
            }
            
            // Summary header
            let summaryHtml = '';
            if (summary) {
                const { high, medium, low } = summary.conflictSeverity;
                summaryHtml = \`
                    <div style="background: var(--vscode-textBlockQuote-background); 
                                border-left: 3px solid var(--vscode-focusBorder); 
                                padding: 12px; margin-bottom: 16px; border-radius: 4px;">
                        <div style="font-weight: 600; margin-bottom: 8px;">
                            Found \${conflicts.length} package conflicts across \${summary.totalProjects} projects
                        </div>
                        <div style="font-size: 12px; opacity: 0.8;">
                            \${high > 0 ? \`\${high} high severity, \` : ''}\${medium > 0 ? \`\${medium} medium severity, \` : ''}\${low > 0 ? \`\${low} low severity\` : ''}
                        </div>
                    </div>
                \`;
            }
            
            const conflictItems = conflicts.map(conflict => {
                const severityColor = {
                    high: '#f14c4c',
                    medium: '#ff8c00', 
                    low: '#ffcd3c'
                }[conflict.conflictSeverity];
                
                const versionsDisplay = conflict.versions.map(v => 
                    \`\${v.version} (used in \${v.usageCount} project\${v.usageCount > 1 ? 's' : ''})\`
                ).join(', ');
                
                return \`
                    <div class="package-item" style="border-left: 3px solid \${severityColor};">
                        <div class="package-name">
                            \${conflict.packageId}
                            <span style="background: \${severityColor}; color: white; padding: 2px 6px;
                                         border-radius: 3px; font-size: 10px; margin-left: 8px;">
                                \${conflict.conflictSeverity.toUpperCase()}
                            </span>
                        </div>
                        <div class="package-description">\${conflict.impactDescription}</div>
                        <div style="margin: 8px 0; font-size: 11px; background: var(--vscode-textPreformat-background);
                                    padding: 6px; border-radius: 3px;">
                            Versions: \${versionsDisplay}
                        </div>
                        <div class="package-meta">
                            <span>Recommended: \${conflict.recommendedVersion}</span>
                            <div class="action-buttons">
                                <vscode-button appearance="primary" onclick="consolidatePackage('\${conflict.packageId}', '\${conflict.recommendedVersion}')">
                                    <span slot="start" class="codicon codicon-check"></span>
                                    Consolidate
                                </vscode-button>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
            
            packageList.innerHTML = summaryHtml + conflictItems;
        }
        
        function consolidatePackage(packageId, targetVersion) {
            const confirmed = confirm(\`Consolidate \${packageId} to version \${targetVersion}?\\n\\nThis will update all projects to use the same version.\`);
            if (confirmed) {
                vscode.postMessage({
                    type: 'consolidatePackage',
                    packageId: packageId,
                    targetVersion: targetVersion
                });
                
                // Reload consolidation after operation
                setTimeout(() => {
                    loadConsolidation();
                }, 3000);
            }
        }
        
        function performSearch(query) {
            if (query.trim().length < 2) {
                showEmptySearch();
                return;
            }

            showSearching();
            currentQuery = query;

            vscode.postMessage({
                type: 'searchPackages',
                query: query,
                includePrerelease: includePrerelease
            });
        }
        
        function showSearching() {
            const packageList = document.querySelector('#browse .package-list');
            packageList.innerHTML = \`
                <div class="empty-state">
                    <div class="empty-icon">🔄</div>
                    <h3>Searching packages...</h3>
                    <p>Please wait while we search nuget.org</p>
                </div>
            \`;
        }
        
        function showEmptySearch() {
            const packageList = document.querySelector('#browse .package-list');
            packageList.innerHTML = \`
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Search for packages</h3>
                    <p>Enter a search term to find NuGet packages</p>
                </div>
            \`;
        }

        function showSearching() {
            const packageList = document.getElementById('browse-list');
            packageList.innerHTML = \`
                <div class="loading-container">
                    <span class="codicon codicon-loading codicon-spin"></span>
                    <span>Searching packages...</span>
                </div>
            \`;
        }

        function showEmptySearch() {
            const packageList = document.getElementById('browse-list');
            packageList.innerHTML = \`
                <div class="empty-state">
                    <span class="codicon codicon-search empty-icon"></span>
                    <h3>Search for packages</h3>
                    <p>Enter a search term to find NuGet packages</p>
                </div>
            \`;
        }

        function displaySearchResults(results, query) {
            const packageList = document.getElementById('browse-list');
            
            if (!results || results.length === 0) {
                packageList.innerHTML = \`
                    <div class="empty-state">
                        <span class="codicon codicon-package empty-icon"></span>
                        <h3>No packages found</h3>
                        <p>No packages match your search for "\${query}"</p>
                    </div>
                \`;
                return;
            }
            
            const packageItems = results.map(pkg => {
                const latestVersion = pkg.version || (pkg.versions && pkg.versions[0] ? pkg.versions[0].version : 'Unknown');
                const description = pkg.description || 'No description available';
                const downloadCount = pkg.totalDownloads ? pkg.totalDownloads.toLocaleString() : 'N/A';
                
                return \`
                    <div class="package-item" onclick="selectPackage('\${pkg.id}', '\${latestVersion}')">
                        <div class="package-name">\${pkg.id}</div>
                        <div class="package-description">\${description}</div>
                        <div class="package-meta">
                            <span>Downloads: \${downloadCount}</span>
                            <div class="action-buttons">
                                <span class="package-version">\${latestVersion}</span>
                                <vscode-button appearance="primary" onclick="selectPackage('\${pkg.id}', '\${latestVersion}'); event.stopPropagation();">
                                    <span slot="start" class="codicon codicon-cloud-download"></span>
                                    Install
                                </vscode-button>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
            
            packageList.innerHTML = packageItems;
        }
        
        function selectPackage(packageId, version) {
            const confirmed = confirm(\`Install \${packageId} version \${version}?\`);
            if (confirmed) {
                vscode.postMessage({
                    type: 'installPackage',
                    packageId: packageId,
                    version: version
                });
            }
        }
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'searchResults':
                    displaySearchResults(message.results, message.query);
                    break;
                case 'installedPackages':
                    displayInstalledPackages(message.packages);
                    break;
                case 'packageUpdates':
                    displayPackageUpdates(message.updates);
                    break;
                case 'packageConflicts':
                    displayPackageConflicts(message.conflicts, message.summary);
                    break;
            }
        });
        
        // Initialize on page load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                initializeUI();
            });
        } else {
            initializeUI();
        }

        function initializeUI() {
            // Listen for panel tab changes
            const panels = document.getElementById('nuget-panels');
            if (panels) {
                panels.addEventListener('change', function(e) {
                    const activeTabId = e.target.activeid;
                    handleTabChange(activeTabId);
                });
            }

            // Initialize search inputs
            setupSearchInputs();

            // Initialize dropdowns
            setupDropdowns();
        }
    </script>
</body>
</html>`;
    }

    private getImprovedNugetManagerHtml(solutionName: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NuGet Package Manager</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.39/dist/codicon.css">
    <script type="module" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit@1.4.0/dist/toolkit.js"></script>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .main-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .content-area {
            flex: 1;
            display: flex;
            overflow: hidden;
        }
        .package-list-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--vscode-panel-border);
        }
        .details-panel {
            width: 400px;
            background-color: var(--vscode-sideBar-background);
            display: flex;
            flex-direction: column;
        }
        .details-header {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-titleBar-activeBackground);
        }
        .details-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
        }
        vscode-panels {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        vscode-panel-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        vscode-data-grid {
            flex: 1;
            height: 100%;
        }
        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            opacity: 0.6;
            padding: 40px 20px;
        }
        .search-toolbar {
            padding: 12px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .package-details h3 {
            margin-top: 0;
            margin-bottom: 12px;
        }
        .version-badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            margin-right: 8px;
        }
        .project-list {
            list-style: none;
            padding: 0;
            margin: 8px 0;
        }
        .project-list li {
            padding: 4px 0;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="main-container">
        <!-- Search toolbar -->
        <div class="search-toolbar">
            <vscode-text-field placeholder="Search packages..." id="search-input" style="flex: 1;">
                <span slot="start" class="codicon codicon-search"></span>
            </vscode-text-field>
            <vscode-dropdown id="source-dropdown">
                <vscode-option value="nuget.org">Package source: nuget.org</vscode-option>
            </vscode-dropdown>
            <vscode-checkbox id="prerelease-checkbox">Include prerelease</vscode-checkbox>
        </div>

        <div class="content-area">
            <!-- Package list area -->
            <div class="package-list-container">
                <vscode-panels id="package-panels" activeid="tab-installed">
                    <vscode-panel-tab id="tab-browse">Browse</vscode-panel-tab>
                    <vscode-panel-tab id="tab-installed">Installed</vscode-panel-tab>
                    <vscode-panel-tab id="tab-updates">Updates</vscode-panel-tab>
                    <vscode-panel-tab id="tab-consolidate">Consolidate</vscode-panel-tab>

                    <!-- Browse Panel -->
                    <vscode-panel-view id="view-browse">
                        <vscode-data-grid id="browse-grid" aria-label="Browse packages">
                            <vscode-data-grid-row row-type="header">
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="1">Package</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="2">Version</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="3">Downloads</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="4">Actions</vscode-data-grid-cell>
                            </vscode-data-grid-row>
                        </vscode-data-grid>
                    </vscode-panel-view>

                    <!-- Installed Panel -->
                    <vscode-panel-view id="view-installed">
                        <vscode-data-grid id="installed-grid" aria-label="Installed packages">
                            <vscode-data-grid-row row-type="header">
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="1">Package</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="2">Version</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="3">Projects</vscode-data-grid-cell>
                            </vscode-data-grid-row>
                        </vscode-data-grid>
                    </vscode-panel-view>

                    <!-- Updates Panel -->
                    <vscode-panel-view id="view-updates">
                        <vscode-data-grid id="updates-grid" aria-label="Package updates">
                            <vscode-data-grid-row row-type="header">
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="1">Package</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="2">Current</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="3">Latest</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="4">Projects</vscode-data-grid-cell>
                            </vscode-data-grid-row>
                        </vscode-data-grid>
                    </vscode-panel-view>

                    <!-- Consolidate Panel -->
                    <vscode-panel-view id="view-consolidate">
                        <vscode-data-grid id="consolidate-grid" aria-label="Package consolidation">
                            <vscode-data-grid-row row-type="header">
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="1">Package</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="2">Versions</vscode-data-grid-cell>
                                <vscode-data-grid-cell cell-type="columnheader" grid-column="3">Recommended</vscode-data-grid-cell>
                            </vscode-data-grid-row>
                        </vscode-data-grid>
                    </vscode-panel-view>
                </vscode-panels>
            </div>

            <!-- Details panel -->
            <div class="details-panel">
                <div class="details-header">
                    <h3>Package Details</h3>
                    <p style="margin: 0; color: var(--vscode-descriptionForeground); font-size: 13px;">Select a package to view details</p>
                </div>
                <div class="details-content" id="details-content">
                    <div class="empty-state">
                        <span class="codicon codicon-info" style="font-size: 32px; margin-bottom: 8px; color: var(--vscode-descriptionForeground);"></span>
                        <p>No package selected</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let searchTimeout;
        let currentPackages = {};
        let selectedPackage = null;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initializeEventListeners();
            loadInstalledPackages();
        });

        function initializeEventListeners() {
            // Search input
            document.getElementById('search-input').addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => performSearch(e.target.value), 500);
            });

            // Tab changes
            document.getElementById('package-panels').addEventListener('change', (e) => {
                handleTabChange(e.target.activeid);
            });

            // Grid selection
            setupGridSelectionHandlers();
        }

        function setupGridSelectionHandlers() {
            ['browse-grid', 'installed-grid', 'updates-grid', 'consolidate-grid'].forEach(gridId => {
                const grid = document.getElementById(gridId);
                if (grid) {
                    grid.addEventListener('click', (e) => {
                        const row = e.target.closest('vscode-data-grid-row[row-type="default"]');
                        if (row) {
                            const packageId = row.dataset.packageId;
                            if (packageId && currentPackages[packageId]) {
                                selectPackage(currentPackages[packageId]);
                            }
                        }
                    });
                }
            });
        }

        function handleTabChange(activeTabId) {
            // Clear details panel when switching tabs
            showEmptyDetails();

            switch(activeTabId) {
                case 'tab-browse':
                    loadBrowsePackages();
                    break;
                case 'tab-installed':
                    loadInstalledPackages();
                    break;
                case 'tab-updates':
                    loadUpdates();
                    break;
                case 'tab-consolidate':
                    loadConsolidation();
                    break;
            }
        }

        function performSearch(query) {
            if (!query.trim()) {
                clearBrowseGrid();
                return;
            }

            // Show search in browse tab
            const browseGrid = document.getElementById('browse-grid');
            clearGridData(browseGrid);

            vscode.postMessage({
                type: 'searchPackages',
                query: query,
                includePrerelease: document.getElementById('prerelease-checkbox').checked
            });
        }

        function loadBrowsePackages() {
            const grid = document.getElementById('browse-grid');
            clearGridData(grid);
            // Browse starts empty - user needs to search
        }

        function clearBrowseGrid() {
            const grid = document.getElementById('browse-grid');
            clearGridData(grid);
        }

        function loadInstalledPackages() {
            const grid = document.getElementById('installed-grid');
            clearGridData(grid);
            vscode.postMessage({ type: 'loadInstalledPackages' });
        }

        function loadUpdates() {
            const grid = document.getElementById('updates-grid');
            clearGridData(grid);
            vscode.postMessage({ type: 'checkForUpdates' });
        }

        function loadConsolidation() {
            const grid = document.getElementById('consolidate-grid');
            clearGridData(grid);
            vscode.postMessage({ type: 'analyzeConflicts' });
        }

        function showEmptyDetails() {
            const detailsContent = document.getElementById('details-content');
            detailsContent.innerHTML = \`
                <div class="empty-state">
                    <span class="codicon codicon-info" style="font-size: 32px; margin-bottom: 8px; color: var(--vscode-descriptionForeground);"></span>
                    <p>No package selected</p>
                </div>
            \`;
        }

        function clearGridData(grid) {
            const rows = grid.querySelectorAll('vscode-data-grid-row[row-type="default"]');
            rows.forEach(row => row.remove());
        }

        function displayInstalledPackages(packages) {
            const grid = document.getElementById('installed-grid');
            currentPackages = {};

            // Group packages by ID
            const packageGroups = {};
            packages.forEach(pkg => {
                if (!packageGroups[pkg.id]) {
                    packageGroups[pkg.id] = {
                        id: pkg.id,
                        versions: new Set(),
                        projects: []
                    };
                }
                packageGroups[pkg.id].versions.add(pkg.version);
                packageGroups[pkg.id].projects.push({
                    name: pkg.projectName,
                    version: pkg.version,
                    path: pkg.projectPath
                });
            });

            // Create grid rows
            Object.values(packageGroups).forEach(pkg => {
                const versions = Array.from(pkg.versions);
                const packageData = {
                    ...pkg,
                    versions: versions,
                    versionText: versions.length === 1 ? versions[0] : \`\${versions.length} versions\`
                };

                currentPackages[pkg.id] = packageData;

                const row = document.createElement('vscode-data-grid-row');
                row.rowType = 'default';
                row.dataset.packageId = pkg.id;

                row.innerHTML = \`
                    <vscode-data-grid-cell grid-column="1">\${pkg.id}</vscode-data-grid-cell>
                    <vscode-data-grid-cell grid-column="2">\${packageData.versionText}</vscode-data-grid-cell>
                    <vscode-data-grid-cell grid-column="3">\${pkg.projects.length}</vscode-data-grid-cell>
                \`;

                grid.appendChild(row);
            });
        }

        function selectPackage(packageData) {
            selectedPackage = packageData;
            showPackageDetails(packageData);
        }

        function showPackageDetails(pkg) {
            const detailsContent = document.getElementById('details-content');

            detailsContent.innerHTML = \`
                <div class="package-details">
                    <h3>\${pkg.id}</h3>
                    <div style="margin-bottom: 16px;">
                        \${pkg.versions.map(v => \`<span class="version-badge">\${v}</span>\`).join('')}
                    </div>

                    <h4 style="margin: 16px 0 8px 0;">Projects (\${pkg.projects.length})</h4>
                    <ul class="project-list">
                        \${pkg.projects.map(proj => \`<li>\${proj.name} - \${proj.version}</li>\`).join('')}
                    </ul>

                    <div style="margin-top: 24px;">
                        <vscode-button onclick="removePackage('\${pkg.id}')" appearance="secondary">
                            <span slot="start" class="codicon codicon-trash"></span>
                            Remove from all projects
                        </vscode-button>
                    </div>
                </div>
            \`;
        }

        function removePackage(packageId) {
            if (confirm(\`Remove \${packageId} from all projects in the solution?\`)) {
                vscode.postMessage({
                    type: 'removePackage',
                    packageId: packageId
                });
                // Refresh the installed packages list
                setTimeout(() => loadInstalledPackages(), 1000);
            }
        }

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'installedPackages':
                    displayInstalledPackages(message.packages);
                    break;
                case 'searchResults':
                    // displaySearchResults(message.results);
                    break;
                case 'packageUpdates':
                    // displayPackageUpdates(message.updates);
                    break;
                case 'packageConflicts':
                    // displayPackageConflicts(message.conflicts);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}