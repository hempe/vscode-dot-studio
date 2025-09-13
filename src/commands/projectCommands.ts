import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { SolutionService } from '../services/solutionService';
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
        this.registerCommand('runStartupProject', this.runStartupProject.bind(this));
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

    private async setAsStartup(item: any): Promise<void> {
        // Handle both URI and tree item
        let projectPath: string;
        let projectGuid: string | null = null;

        if (item instanceof vscode.Uri) {
            projectPath = item.fsPath;
        } else if (item && item.resourceUri) {
            projectPath = item.resourceUri.fsPath;
            // If it's a tree item, it might already have the GUID
            projectGuid = item.projectGuid || null;
        } else {
            ErrorUtils.showError('No project selected');
            return;
        }

        const projectName = PathUtils.getProjectName(projectPath);

        try {
            // Find the solution file
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                ErrorUtils.showError('No workspace found');
                return;
            }

            const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
            if (solutionFiles.length === 0) {
                ErrorUtils.showError('No solution file found');
                return;
            }

            const solutionPath = solutionFiles[0].fsPath;

            // Get project GUID if we don't have it
            if (!projectGuid) {
                projectGuid = this.solutionProvider.getProjectGuid(projectPath);
                if (!projectGuid) {
                    ErrorUtils.showError(`Project GUID not found for ${projectName}. Make sure the project is part of the solution.`);
                    return;
                }
            }

            // Update .sln.user file
            await SolutionService.setStartupProject(solutionPath, projectGuid);

            vscode.window.showInformationMessage(
                `Set "${projectName}" as startup project in ${path.basename(solutionPath)}`
            );

            // Optional: Also create/update VS Code launch configuration
            const createLaunch = await vscode.window.showInformationMessage(
                'Also create VS Code launch configuration?',
                'Yes',
                'No'
            );

            if (createLaunch === 'Yes') {
                await this.createVSCodeLaunchConfig(projectPath, projectName, workspaceRoot);
            }

        } catch (error) {
            ErrorUtils.showError('Failed to set startup project', error);
        }
    }

    /**
     * Creates a VS Code launch configuration for the project
     */
    private async createVSCodeLaunchConfig(projectPath: string, projectName: string, workspaceRoot: string): Promise<void> {
        try {
            const vscodeDir = path.join(workspaceRoot, '.vscode');
            const launchJsonPath = path.join(vscodeDir, 'launch.json');

            const fs = require('fs');
            if (!fs.existsSync(vscodeDir)) {
                await fs.promises.mkdir(vscodeDir, { recursive: true });
            }

            // Check if launch.json already exists
            let launchConfig: any;
            if (fs.existsSync(launchJsonPath)) {
                const existingConfig = await fs.promises.readFile(launchJsonPath, 'utf8');
                try {
                    launchConfig = JSON.parse(existingConfig);
                } catch {
                    // Invalid JSON, create new config
                    launchConfig = { version: "0.2.0", configurations: [] };
                }
            } else {
                launchConfig = { version: "0.2.0", configurations: [] };
            }

            // Remove any existing configuration with the same name
            const configName = `.NET Core Launch (${projectName})`;
            launchConfig.configurations = launchConfig.configurations.filter(
                (config: any) => config.name !== configName
            );

            // Add new configuration
            const newConfig = {
                name: configName,
                type: "coreclr",
                request: "launch",
                preLaunchTask: "build",
                program: `\${workspaceFolder}/${path.relative(workspaceRoot, path.dirname(projectPath))}/bin/Debug/net6.0/${projectName}.dll`,
                args: [],
                cwd: `\${workspaceFolder}/${path.relative(workspaceRoot, path.dirname(projectPath))}`,
                console: "integratedTerminal",
                stopAtEntry: false
            };

            launchConfig.configurations.push(newConfig);

            await fs.promises.writeFile(launchJsonPath, JSON.stringify(launchConfig, null, 2), 'utf8');
            vscode.window.showInformationMessage(`VS Code launch configuration created for ${projectName}`);

        } catch (error) {
            ErrorUtils.showError('Failed to create VS Code launch configuration', error);
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

    /**
     * Runs the startup project (F5 functionality) with debugger attachment
     */
    private async runStartupProject(): Promise<void> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                ErrorUtils.showError('No workspace found');
                return;
            }

            // Find the solution file
            const solutionPath = await SolutionService.findSolutionFile(workspaceRoot);
            if (!solutionPath) {
                ErrorUtils.showError('No solution file found');
                return;
            }

            // Get the current startup project GUID
            const startupProjectGuid = await SolutionService.getCurrentStartupProject(solutionPath);

            if (!startupProjectGuid) {
                // No startup project set, let user choose one
                await this.promptForStartupProject(solutionPath);
                return;
            }

            // Find the project path from the GUID
            const projectPath = await SolutionService.getProjectPath(solutionPath, startupProjectGuid);
            if (!projectPath) {
                ErrorUtils.showError('Startup project not found in solution. Please set a startup project.');
                return;
            }

            // Check if project file exists
            const fs = require('fs');
            if (!fs.existsSync(projectPath)) {
                ErrorUtils.showError(`Startup project file not found: ${projectPath}`);
                return;
            }

            const projectName = PathUtils.getProjectName(projectPath);

            // Start debugging the project instead of just running it
            await this.debugProject(projectPath, projectName);

        } catch (error) {
            ErrorUtils.showError('Failed to run startup project', error);
        }
    }

    /**
     * Starts debugging a specific project (equivalent to F5 in Visual Studio)
     */
    private async debugProject(projectPath: string, projectName: string): Promise<void> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                ErrorUtils.showError('No workspace found');
                return;
            }

            const programPath = await this.findProgramPath(projectPath, projectName);
            const targetFrameworks = await this.getTargetFrameworks(projectPath);
            const isNetFramework = targetFrameworks.some(f => f.startsWith('net4') || f.startsWith('net3') || f.startsWith('net2'));

            // Create a temporary launch configuration for debugging
            let debugConfig: any = {
                name: `Debug ${projectName}`,
                request: 'launch',
                args: [],
                cwd: path.dirname(projectPath),
                console: 'integratedTerminal',
                stopAtEntry: false
            };

            // Always use CoreCLR debugger type - Mono integration is handled transparently
            debugConfig.type = 'coreclr';
            debugConfig.program = programPath;

            // Build the project first
            vscode.window.showInformationMessage(`Building and starting debug session: ${projectName}`);

            const buildSuccess = await this.buildProjectForDebug(projectPath, projectName);
            if (!buildSuccess) {
                vscode.window.showErrorMessage(`Build failed for ${projectName}. Cannot start debugging.`);
                return;
            }

            // Start the debug session
            const success = await vscode.debug.startDebugging(undefined, debugConfig);

            if (!success) {
                // Fallback to running without debugger
                vscode.window.showWarningMessage(`Failed to start debugger for ${projectName}. Running without debugger...`);
                await this.fallbackRun(projectPath, projectName);
            }

        } catch (error) {
            console.error('Error starting debug session:', error);
            // Fallback to running without debugger
            vscode.window.showWarningMessage(`Debug failed for ${projectName}. Running without debugger...`);
            await this.fallbackRun(projectPath, projectName);
        }
    }

    /**
     * Finds the program path for debugging (the built executable)
     * Handles projects with multiple target frameworks
     */
    private async findProgramPath(projectPath: string, projectName: string): Promise<string> {
        const projectDir = path.dirname(projectPath);
        const debugPath = path.join(projectDir, 'bin', 'Debug');

        try {
            // Parse the project file to get target framework(s)
            const targetFrameworks = await this.getTargetFrameworks(projectPath);

            // Check if Mono is available for .NET Framework projects on non-Windows
            const hasNetFramework = targetFrameworks.some(f => f.startsWith('net4') || f.startsWith('net3') || f.startsWith('net2'));
            const hasNetCore = targetFrameworks.some(f => f.startsWith('netcore') || f.startsWith('net5') || f.startsWith('net6') || f.startsWith('net7') || f.startsWith('net8'));

            if (hasNetFramework && !hasNetCore && process.platform !== 'win32') {
                // Check if Mono is available
                const monoAvailable = await this.checkMonoAvailability();
                if (!monoAvailable) {
                    throw new Error(`Cannot debug .NET Framework project (${targetFrameworks.join(', ')}) on ${process.platform}. Install Mono or use a .NET Core/.NET 5+ target framework.`);
                }
            }

            // If multiple target frameworks, prefer the latest one
            const preferredFramework = this.selectPreferredFramework(targetFrameworks);

            // Try the preferred framework first
            if (preferredFramework) {
                const dllPath = path.join(debugPath, preferredFramework, `${projectName}.dll`);

                const fs = require('fs');
                if (fs.existsSync(dllPath)) {
                    return dllPath;
                }

                // On Windows, also check for .exe files
                if (process.platform === 'win32') {
                    const exePath = path.join(debugPath, preferredFramework, `${projectName}.exe`);
                    if (fs.existsSync(exePath)) {
                        return exePath;
                    }
                }
            }

            // Fallback: try all target frameworks from project
            for (const framework of targetFrameworks) {
                const dllPath = path.join(debugPath, framework, `${projectName}.dll`);

                const fs = require('fs');
                if (fs.existsSync(dllPath)) {
                    return dllPath;
                }

                // On Windows, also check for .exe files
                if (process.platform === 'win32') {
                    const exePath = path.join(debugPath, framework, `${projectName}.exe`);
                    if (fs.existsSync(exePath)) {
                        return exePath;
                    }
                }
            }

            // Final fallback: scan all directories in bin/Debug
            const fs = require('fs');
            if (fs.existsSync(debugPath)) {
                const entries = fs.readdirSync(debugPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const dllPath = path.join(debugPath, entry.name, `${projectName}.dll`);

                        if (fs.existsSync(dllPath)) {
                            return dllPath;
                        }

                        // On Windows, also check for .exe files
                        if (process.platform === 'win32') {
                            const exePath = path.join(debugPath, entry.name, `${projectName}.exe`);
                            if (fs.existsSync(exePath)) {
                                return exePath;
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.warn('Error parsing project file for target frameworks:', error);
        }

        // Ultimate fallback
        return path.join(debugPath, 'net6.0', `${projectName}.dll`);
    }

    /**
     * Gets target framework(s) from project file
     */
    private async getTargetFrameworks(projectPath: string): Promise<string[]> {
        try {
            const fs = require('fs');
            const xml2js = require('xml2js');

            const projectContent = await fs.promises.readFile(projectPath, 'utf8');
            const parser = new xml2js.Parser({ explicitArray: false });
            const projectXml = await parser.parseStringPromise(projectContent);

            const project = projectXml.Project;
            if (!project || !project.PropertyGroup) {
                return ['net6.0']; // Default fallback
            }

            // Handle single or multiple PropertyGroups
            const propertyGroups = Array.isArray(project.PropertyGroup) ? project.PropertyGroup : [project.PropertyGroup];

            for (const group of propertyGroups) {
                // Check for TargetFrameworks (plural) first
                if (group.TargetFrameworks) {
                    return group.TargetFrameworks.split(';').map((f: string) => f.trim()).filter((f: string) => f);
                }
                // Then check for TargetFramework (singular)
                if (group.TargetFramework) {
                    return [group.TargetFramework.trim()];
                }
            }

            return ['net6.0']; // Default fallback
        } catch (error) {
            console.error('Error parsing project file:', error);
            return ['net6.0']; // Default fallback
        }
    }

    /**
     * Selects the preferred framework from multiple target frameworks
     * Always prefers the highest/latest version available
     */
    private selectPreferredFramework(frameworks: string[]): string | null {
        if (frameworks.length === 0) return null;
        if (frameworks.length === 1) return frameworks[0];

        // Always prefer the highest version, regardless of platform
        // This ensures better performance and debugging experience
        const preferenceOrder = [
            'net8.0', 'net7.0', 'net6.0', 'net5.0',
            'netcoreapp3.1', // Keep this one as it's LTS
            'net48', 'net472', 'net471', 'net47', // Still commonly used
            'netstandard2.1', 'netstandard2.0'
        ];

        for (const preferred of preferenceOrder) {
            if (frameworks.includes(preferred)) {
                return preferred;
            }
        }

        // If no match in preference order, return the first one
        return frameworks[0];
    }

    /**
     * Checks if Mono is available on the system
     */
    private async checkMonoAvailability(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const { exec } = require('child_process');

            exec('mono --version', (error: any) => {
                resolve(!error);
            });
        });
    }

    /**
     * Builds the project for debugging with progress indication
     */
    private async buildProjectForDebug(projectPath: string, projectName: string): Promise<boolean> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building ${projectName}`,
            cancellable: true
        }, async (progress, token) => {
            return new Promise<boolean>((resolve) => {
                const { exec } = require('child_process');
                const projectDir = path.dirname(projectPath);

                // Build the project using child_process to get actual results
                const buildCommand = `dotnet build "${projectPath}" --configuration Debug --verbosity minimal`;

                progress.report({ message: 'Starting build (this may take a few minutes for first build with NuGet restore)...' });

                const buildProcess = exec(buildCommand, { cwd: projectDir }, (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        console.error('Build error:', error);
                        console.error('Build stderr:', stderr);
                        vscode.window.showErrorMessage(`Build failed: ${error.message}`);
                        resolve(false);
                    } else {
                        console.log('Build output:', stdout);
                        if (stderr && !stderr.includes('warning')) {
                            // If there are errors (not just warnings) in stderr
                            console.error('Build stderr:', stderr);
                            vscode.window.showErrorMessage('Build completed with errors');
                            resolve(false);
                        } else {
                            vscode.window.showInformationMessage(`Build succeeded for ${projectName}`);
                            resolve(true);
                        }
                    }
                });

                // Handle cancellation
                token.onCancellationRequested(() => {
                    if (buildProcess && !buildProcess.killed) {
                        buildProcess.kill();
                        vscode.window.showWarningMessage('Build was cancelled');
                        resolve(false);
                    }
                });

                // Set a timeout for the build process (5 minutes to allow for NuGet restore)
                setTimeout(() => {
                    if (buildProcess && !buildProcess.killed) {
                        buildProcess.kill();
                        vscode.window.showErrorMessage('Build timed out after 5 minutes');
                        resolve(false);
                    }
                }, 300000); // 5 minute timeout
            });
        });
    }

    /**
     * Fallback method - runs the project without debugger
     */
    private async fallbackRun(projectPath: string, projectName: string): Promise<void> {
        TerminalUtils.createDotnetTerminal('Run', projectPath, 'dotnet run');
        vscode.window.showInformationMessage(`Running ${projectName} without debugger`);
    }

    /**
     * Prompts user to select a startup project when none is set
     */
    private async promptForStartupProject(solutionPath: string): Promise<void> {
        const availableProjects = await SolutionService.getProjectPaths(solutionPath);

        if (availableProjects.length === 0) {
            ErrorUtils.showError('No projects found in solution');
            return;
        }

        if (availableProjects.length === 1) {
            // Only one project, set it as startup automatically
            const projectGuid = await SolutionService.getProjectGuid(solutionPath, availableProjects[0]);
            if (projectGuid) {
                await SolutionService.setStartupProject(solutionPath, projectGuid);
                const projectName = PathUtils.getProjectName(availableProjects[0]);
                vscode.window.showInformationMessage(`Set "${projectName}" as startup project and debugging...`);
                await this.debugProject(availableProjects[0], projectName);
                return;
            }
        }

        // Multiple projects, let user choose
        const projectItems = availableProjects.map(p => ({
            label: PathUtils.getProjectName(p),
            description: path.relative(path.dirname(solutionPath), p),
            path: p
        }));

        const selectedProject = await vscode.window.showQuickPick(projectItems, {
            placeHolder: 'Select a startup project to debug',
            canPickMany: false
        });

        if (selectedProject) {
            // Set as startup project and debug
            const projectGuid = await SolutionService.getProjectGuid(solutionPath, selectedProject.path);
            if (projectGuid) {
                await SolutionService.setStartupProject(solutionPath, projectGuid);
                vscode.window.showInformationMessage(`Set "${selectedProject.label}" as startup project and debugging...`);
                await this.debugProject(selectedProject.path, selectedProject.label);
            } else {
                ErrorUtils.showError('Could not find project GUID');
            }
        }
    }

}