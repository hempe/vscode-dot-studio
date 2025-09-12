import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, ErrorUtils, InputUtils } from '../utils';
import { NuGetService, NuGetSearchOptions } from '../services/nugetService';
import { TerminalService } from '../services/terminalService';
import { WebviewService } from '../services/webviewService';

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
        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.solutionPath || (item.resourceUri ? item.resourceUri.fsPath : null);
        if (!solutionPath) {
            ErrorUtils.showError('Cannot find solution path');
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
            const folderEntry = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${folderName}", "${folderName}", "${folderGuid}"\nEndProject`;
            
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
        panel.webview.html = this.getNugetManagerHtml(solutionName);
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
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background-color: var(--vscode-titleBar-activeBackground, var(--vscode-menu-background));
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
        
        .tab-container {
            display: flex;
            background-color: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }
        
        .tab {
            padding: 12px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            font-size: 13px;
            user-select: none;
            transition: all 0.2s;
        }
        
        .tab:hover {
            background-color: var(--vscode-tab-hoverBackground, rgba(255,255,255,0.1));
        }
        
        .tab.active {
            border-bottom-color: var(--vscode-focusBorder, #007ACC);
            background-color: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
        }
        
        .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .tab-content {
            display: none;
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }
        
        .tab-content.active {
            display: flex;
            flex-direction: column;
        }
        
        .search-container {
            margin-bottom: 20px;
        }
        
        .search-box {
            width: 100%;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
        }
        
        .search-box:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007ACC);
        }
        
        .package-list {
            flex: 1;
            background-color: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.04));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow-y: auto;
        }
        
        .package-item {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .package-item:hover {
            background-color: var(--vscode-list-hoverBackground, rgba(255,255,255,0.08));
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
        }
        
        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        
        .filter-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 16px;
            align-items: center;
        }
        
        .filter-select {
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            color: var(--vscode-dropdown-foreground);
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
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
    </style>
</head>
<body>
    <div class="header">
        <h1>Manage NuGet Packages for Solution</h1>
        <div class="solution-name">Solution: ${solutionName}</div>
    </div>
    
    <div class="tab-container">
        <div class="tab active" onclick="switchTab('browse')">Browse</div>
        <div class="tab" onclick="switchTab('installed')">Installed</div>
        <div class="tab" onclick="switchTab('updates')">Updates</div>
        <div class="tab" onclick="switchTab('consolidate')">Consolidate</div>
    </div>
    
    <div class="content">
        <!-- Browse Tab -->
        <div id="browse" class="tab-content active">
            <div class="filter-bar">
                <select class="filter-select">
                    <option>Package source: nuget.org</option>
                    <option>Package source: All</option>
                </select>
                <select class="filter-select">
                    <option>Include prerelease: No</option>
                    <option>Include prerelease: Yes</option>
                </select>
            </div>
            <div class="search-container">
                <input type="text" class="search-box" placeholder="Search packages..." />
            </div>
            <div class="package-list">
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Search for packages</h3>
                    <p>Enter a search term to find NuGet packages</p>
                </div>
            </div>
        </div>
        
        <!-- Installed Tab -->
        <div id="installed" class="tab-content">
            <div class="search-container">
                <input type="text" class="search-box" placeholder="Search installed packages..." />
            </div>
            <div class="package-list">
                <div class="empty-state">
                    <div class="empty-icon">📦</div>
                    <h3>No packages installed</h3>
                    <p>Install packages from the Browse tab</p>
                </div>
            </div>
        </div>
        
        <!-- Updates Tab -->
        <div id="updates" class="tab-content">
            <div class="package-list">
                <div class="empty-state">
                    <div class="empty-icon">⬆️</div>
                    <h3>All packages are up to date</h3>
                    <p>No updates available for installed packages</p>
                </div>
            </div>
        </div>
        
        <!-- Consolidate Tab -->
        <div id="consolidate" class="tab-content">
            <div class="package-list">
                <div class="empty-state">
                    <div class="empty-icon">🔗</div>
                    <h3>No version conflicts</h3>
                    <p>All packages have consistent versions across projects</p>
                </div>
            </div>
        </div>
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
        
        function switchTab(tabName) {
            // Hide all tab contents
            const contents = document.querySelectorAll('.tab-content');
            contents.forEach(content => content.classList.remove('active'));
            
            // Remove active class from all tabs
            const tabs = document.querySelectorAll('.tab');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            // Show selected tab content
            document.getElementById(tabName).classList.add('active');
            
            // Mark selected tab as active
            event.target.classList.add('active');
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
        
        function displaySearchResults(results, query) {
            const packageList = document.querySelector('#browse .package-list');
            
            if (!results || results.length === 0) {
                packageList.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-icon">📭</div>
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
                            <span class="package-version">\${latestVersion}</span>
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
            }
        });
        
        // Handle search input with debouncing
        document.querySelectorAll('.search-box').forEach(searchBox => {
            searchBox.addEventListener('input', function(e) {
                const isInBrowseTab = e.target.closest('#browse');
                if (!isInBrowseTab) return;
                
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    performSearch(e.target.value);
                }, 500); // 500ms debounce
            });
        });
        
        // Handle prerelease filter
        document.querySelectorAll('.filter-select').forEach(select => {
            select.addEventListener('change', function(e) {
                if (e.target.value.includes('Include prerelease: Yes')) {
                    includePrerelease = true;
                } else if (e.target.value.includes('Include prerelease: No')) {
                    includePrerelease = false;
                }
                
                // Re-search if there's a current query
                if (currentQuery) {
                    performSearch(currentQuery);
                }
            });
        });
    </script>
</body>
</html>`;
    }
}