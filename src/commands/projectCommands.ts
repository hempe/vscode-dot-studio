import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, TerminalUtils, ErrorUtils, InputUtils } from '../utils';

export class ProjectCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider
    ) { }

    public registerCommands(): void {
        this.registerCommand('manageNugetPackages', this.manageNugetPackages.bind(this));
        this.registerCommand('setAsStartup', this.setAsStartup.bind(this));
        this.registerCommand('removeProject', this.removeProject.bind(this));
        this.registerCommand('addProjectReference', this.addProjectReference.bind(this));
        this.registerCommand('addNugetPackage', this.addNugetPackage.bind(this));
        this.registerCommand('addFrameworkReference', this.addFrameworkReference.bind(this));
        this.registerCommand('build', this.build.bind(this));
        this.registerCommand('rebuild', this.rebuild.bind(this));
        this.registerCommand('clean', this.clean.bind(this));
        this.registerCommand('openContainingFolder', this.openContainingFolder.bind(this));
        this.registerCommand('removeProjectFromSolution', this.removeProjectFromSolution.bind(this));
    }

    private registerCommand(commandName: string, callback: (...args: any[]) => any): void {
        const command = vscode.commands.registerCommand(`dotnet-extension.${commandName}`, callback);
        this.context.subscriptions.push(command);
    }

    private async manageNugetPackages(item: any): Promise<void> {
        let projectPath: string | null;

        if (item instanceof vscode.Uri) {
            // Called from file explorer
            projectPath = item.fsPath;
        } else {
            // Called from tree view (dependencies node)
            projectPath = PathUtils.getPathFromItem(item, 'manage NuGet packages');
            if (!projectPath) return;
        }
        const projectName = PathUtils.getProjectName(projectPath);

        const action = await vscode.window.showInformationMessage(
            `NuGet package management for ${projectName}`,
            'Add Package',
            'Open Package Manager Console'
        );

        if (action === 'Add Package') {
            vscode.commands.executeCommand('dotnet-extension.addNugetPackage', item);
        } else if (action === 'Open Package Manager Console') {
            TerminalUtils.createDotnetTerminal('Package Manager', projectPath);
            vscode.window.showInformationMessage('Use dotnet CLI commands for advanced package management');
        }
    }

    private async setAsStartup(uri: vscode.Uri): Promise<void> {
        if (!uri) {
            ErrorUtils.showError('No project selected');
            return;
        }

        const projectPath = uri.fsPath;
        const projectName = PathUtils.getProjectName(projectPath);

        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                ErrorUtils.showError('No workspace found');
                return;
            }

            const vscodeDir = path.join(workspaceRoot, '.vscode');
            const launchJsonPath = path.join(vscodeDir, 'launch.json');

            const fs = require('fs');
            if (!fs.existsSync(vscodeDir)) {
                await fs.promises.mkdir(vscodeDir, { recursive: true });
            }

            const launchConfig = {
                version: "0.2.0",
                configurations: [
                    {
                        name: `.NET Core Launch (${projectName})`,
                        type: "coreclr",
                        request: "launch",
                        preLaunchTask: "build",
                        program: `\${workspaceFolder}/${path.relative(workspaceRoot, path.dirname(projectPath))}/bin/Debug/net6.0/${projectName}.dll`,
                        args: [],
                        cwd: `\${workspaceFolder}/${path.relative(workspaceRoot, path.dirname(projectPath))}`,
                        console: "integratedTerminal",
                        stopAtEntry: false
                    }
                ]
            };

            await fs.promises.writeFile(launchJsonPath, JSON.stringify(launchConfig, null, 2), 'utf8');

            vscode.window.showInformationMessage(
                `Set "${projectName}" as startup project. Launch configuration created in .vscode/launch.json`
            );

            const openConfig = await vscode.window.showInformationMessage(
                'Would you like to review the launch configuration?',
                'Open launch.json'
            );

            if (openConfig === 'Open launch.json') {
                const launchUri = vscode.Uri.file(launchJsonPath);
                await vscode.window.showTextDocument(launchUri);
            }

        } catch (error) {
            ErrorUtils.showError('Failed to set startup project', error);
        }
    }

    private async removeProject(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No project selected');
            return;
        }

        const projectPath = item.resourceUri.fsPath;
        const projectName = PathUtils.getProjectName(projectPath);

        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${projectName}" from the solution?`,
            { modal: true },
            'Remove'
        );

        if (confirmed === 'Remove') {
            // Find the solution file
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) return;

            const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
            if (solutionFiles.length === 0) {
                ErrorUtils.showError('No solution file found');
                return;
            }

            const solutionPath = solutionFiles[0].fsPath;
            const success = await this.solutionProvider.removeProjectFromSolution(solutionPath, projectPath);

            if (success) {
                vscode.window.showInformationMessage(`Removed "${projectName}" from solution`);
            }
        }
    }

    private async addProjectReference(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'add project reference');
        if (!projectPath) return;

        const projectDir = path.dirname(projectPath);
        const projectName = PathUtils.getProjectName(projectPath);

        // Get available projects from solution
        const availableProjects = await this.solutionProvider.getAvailableProjects();

        if (availableProjects.length === 0) {
            ErrorUtils.showError('No other projects found in solution');
            return;
        }

        const projectItems = availableProjects
            .filter(p => p !== projectPath)
            .map(p => ({
                label: PathUtils.getProjectName(p),
                path: p
            }));

        const selectedProject = await InputUtils.showQuickPick(projectItems, 'Select project to reference');

        if (selectedProject && !Array.isArray(selectedProject)) {
            try {
                TerminalUtils.createAndShow(
                    'Add Project Reference',
                    projectDir,
                    `dotnet add reference "${selectedProject.path}"`
                );

                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Added reference to ${selectedProject.label}`);
            } catch (error) {
                ErrorUtils.showError('Failed to add project reference', error);
            }
        }
    }

    private async addNugetPackage(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'add NuGet package');
        if (!projectPath) return;

        const packageName = await InputUtils.showInputBox(
            'Enter NuGet package name',
            undefined,
            (value) => {
                if (!value || value.trim() === '') {
                    return 'Package name cannot be empty';
                }
                return null;
            }
        );

        if (!packageName) return;

        const projectDir = path.dirname(projectPath);
        const terminal = TerminalUtils.createAndShow(
            'Add NuGet Package',
            projectDir,
            `dotnet add package "${packageName}"`
        );

        this.solutionProvider.refresh();
        vscode.window.showInformationMessage(`Adding NuGet package: ${packageName}`);
    }

    private async addFrameworkReference(item: any): Promise<void> {
        // Get project path from the dependencies node - we need to find the parent project
        let projectPath: string | undefined;

        if (item && item.projectPath) {
            projectPath = item.projectPath;
        } else {
            ErrorUtils.showError('Cannot determine project path from dependencies node');
            return;
        }

        if (!projectPath)
            return;

        // Common FrameworkReferences available in modern .NET
        const availableFrameworkReferences = [
            {
                label: 'Microsoft.AspNetCore.App',
                description: 'ASP.NET Core shared framework',
                value: 'Microsoft.AspNetCore.App'
            },
            {
                label: 'Microsoft.WindowsDesktop.App',
                description: 'Windows Desktop shared framework (WPF, WinForms)',
                value: 'Microsoft.WindowsDesktop.App'
            },
            {
                label: 'Microsoft.NETCore.App',
                description: '.NET Core runtime (rarely needed explicitly)',
                value: 'Microsoft.NETCore.App'
            }
        ];

        const selectedFramework = await vscode.window.showQuickPick(
            availableFrameworkReferences,
            {
                placeHolder: 'Select a framework reference to add',
                matchOnDescription: true
            }
        );

        if (!selectedFramework) {
            return;
        }

        try {
            const projectName = PathUtils.getProjectName(projectPath);

            // Add the FrameworkReference to the project file
            await this.addFrameworkReferenceToProject(projectPath, selectedFramework.value);

            // Refresh the solution tree to show the new reference
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Added framework reference: ${selectedFramework.label} to ${projectName}`);

        } catch (error) {
            ErrorUtils.showError('Failed to add framework reference', error);
        }
    }

    private async build(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'build project');
        if (!projectPath) return;

        const projectName = PathUtils.getProjectName(projectPath);

        TerminalUtils.createDotnetTerminal('Build', projectPath, 'dotnet build');

        vscode.window.showInformationMessage(`Building ${projectName}...`);
    }

    private async rebuild(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'rebuild project');
        if (!projectPath) return;

        const projectName = PathUtils.getProjectName(projectPath);

        const terminal = TerminalUtils.createDotnetTerminal('Rebuild', projectPath);
        terminal.sendText('dotnet clean');
        terminal.sendText('dotnet build');

        vscode.window.showInformationMessage(`Rebuilding ${projectName}...`);
    }

    private async clean(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'clean project');
        if (!projectPath) return;

        const projectName = PathUtils.getProjectName(projectPath);

        TerminalUtils.createDotnetTerminal('Clean', projectPath, 'dotnet clean');

        vscode.window.showInformationMessage(`Cleaning ${projectName}...`);
    }

    private async openContainingFolder(item: any): Promise<void> {
        const projectPath = PathUtils.getPathFromItem(item, 'open containing folder');
        if (!projectPath) return;

        const projectDir = path.dirname(projectPath);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(projectDir));
    }

    private async removeProjectFromSolution(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No project selected');
            return;
        }

        const projectPath = item.resourceUri.fsPath;
        const projectName = PathUtils.getProjectName(projectPath);

        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${projectName}" from the solution and delete the project files?`,
            { modal: true },
            'Remove and Delete'
        );

        if (confirmed === 'Remove and Delete') {
            try {
                // Find solution file
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot) return;

                const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
                if (solutionFiles.length === 0) {
                    ErrorUtils.showError('No solution file found');
                    return;
                }

                const solutionPath = solutionFiles[0].fsPath;

                // Remove from solution
                await this.solutionProvider.removeProjectFromSolution(solutionPath, projectPath);

                // Delete project directory
                const fs = require('fs');
                const projectDir = path.dirname(projectPath);
                await fs.promises.rm(projectDir, { recursive: true, force: true });

                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Removed and deleted project: ${projectName}`);
            } catch (error) {
                ErrorUtils.showError('Failed to remove project from solution', error);
            }
        }
    }

    private async addFrameworkReferenceToProject(projectPath: string, frameworkReference: string): Promise<void> {
        const fs = require('fs').promises;
        const xml2js = require('xml2js');

        try {
            // Read the project file
            const projectContent = await fs.readFile(projectPath, 'utf8');

            // Parse XML
            const parser = new xml2js.Parser({ explicitArray: false });
            const builder = new xml2js.Builder({
                renderOpts: { pretty: true, indent: '  ' },
                headless: true
            });

            const projectXml = await parser.parseStringPromise(projectContent);

            // Ensure Project.ItemGroup exists
            if (!projectXml.Project.ItemGroup) {
                projectXml.Project.ItemGroup = [];
            }

            // Convert single ItemGroup to array if needed
            if (!Array.isArray(projectXml.Project.ItemGroup)) {
                projectXml.Project.ItemGroup = [projectXml.Project.ItemGroup];
            }

            // Check if FrameworkReference already exists
            let frameworkReferenceExists = false;
            for (const itemGroup of projectXml.Project.ItemGroup) {
                if (itemGroup.FrameworkReference) {
                    const frameworkRefs = Array.isArray(itemGroup.FrameworkReference)
                        ? itemGroup.FrameworkReference
                        : [itemGroup.FrameworkReference];

                    if (frameworkRefs.some((ref: any) => ref.$.Include === frameworkReference)) {
                        frameworkReferenceExists = true;
                        break;
                    }
                }
            }

            if (frameworkReferenceExists) {
                vscode.window.showInformationMessage(`Framework reference ${frameworkReference} already exists in project`);
                return;
            }

            // Find or create an ItemGroup for FrameworkReference
            let targetItemGroup = projectXml.Project.ItemGroup.find((ig: any) => ig.FrameworkReference);

            if (!targetItemGroup) {
                // Create new ItemGroup for FrameworkReference
                targetItemGroup = {};
                projectXml.Project.ItemGroup.push(targetItemGroup);
            }

            // Add FrameworkReference
            if (!targetItemGroup.FrameworkReference) {
                targetItemGroup.FrameworkReference = [];
            }

            if (!Array.isArray(targetItemGroup.FrameworkReference)) {
                targetItemGroup.FrameworkReference = [targetItemGroup.FrameworkReference];
            }

            targetItemGroup.FrameworkReference.push({
                $: { Include: frameworkReference }
            });

            // Build and write back to file
            const updatedXml = builder.buildObject(projectXml);
            await fs.writeFile(projectPath, updatedXml, 'utf8');

        } catch (error) {
            console.error('Error adding framework reference to project:', error);
            throw new Error(`Failed to add framework reference: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}