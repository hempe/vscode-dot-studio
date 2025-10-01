import * as vscode from 'vscode';
export class NuGetWebview {

    public static getHtmlForWebview(
        extensionUri: vscode.Uri,
        webview: vscode.Webview): string {

        // Add Codicons CSS for proper VS Code icons
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'codicons', 'codicon.css'
        ));

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'out', 'webview', 'nuget-view', 'bundle.js'
        ));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';">
                    <title>NuGet Package Manager</title>
                    <style>
                        body {
                            font-family: var(--vscode-font-family);
                            font-size: var(--vscode-font-size);
                            color: var(--vscode-foreground);
                            background-color: var(--vscode-editor-background);
                            margin: 0;
                            padding: 8px;
                        }
    
                        .nuget-manager {
                            display: flex;
                            flex-direction: column;
                            height: 100%;
                            gap: 16px;
                        }
    
                        .search-section {
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
    
                        .search-controls {
                            display: flex;
                            gap: 8px;
                        }
    
                        .search-controls input {
                            flex: 1;
                            padding: 6px 8px;
                            background-color: var(--vscode-input-background);
                            border: 1px solid var(--vscode-input-border);
                            color: var(--vscode-input-foreground);
                            font-size: 12px;
                        }
    
                        .search-controls button {
                            padding: 6px 12px;
                            background-color: var(--vscode-button-background);
                            border: none;
                            color: var(--vscode-button-foreground);
                            cursor: pointer;
                            font-size: 12px;
                        }
    
                        .search-controls button:hover {
                            background-color: var(--vscode-button-hoverBackground);
                        }
    
                        .search-controls button:disabled {
                            opacity: 0.6;
                            cursor: not-allowed;
                        }
    
                        .search-results, .installed-section {
                            border: 1px solid var(--vscode-panel-border);
                            border-radius: 4px;
                            overflow: hidden;
                        }
    
                        .search-results h3, .installed-section h3 {
                            margin: 0;
                            padding: 8px 12px;
                            background-color: var(--vscode-panel-background);
                            border-bottom: 1px solid var(--vscode-panel-border);
                            font-size: 13px;
                            font-weight: 600;
                        }
    
                        .package-item {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 8px 12px;
                            border-bottom: 1px solid var(--vscode-panel-border);
                        }
    
                        .package-item:last-child {
                            border-bottom: none;
                        }
    
                        .package-item:hover {
                            background-color: var(--vscode-list-hoverBackground);
                        }
    
                        .package-info h4 {
                            margin: 0 0 4px 0;
                            font-size: 13px;
                            font-weight: 600;
                        }
    
                        .package-info p {
                            margin: 0 0 4px 0;
                            font-size: 11px;
                            color: var(--vscode-descriptionForeground);
                            line-height: 1.4;
                        }
    
                        .package-info .version, .package-info .authors {
                            font-size: 10px;
                            color: var(--vscode-descriptionForeground);
                            margin-right: 8px;
                        }
    
                        .package-item button {
                            padding: 4px 8px;
                            background-color: var(--vscode-button-background);
                            border: none;
                            color: var(--vscode-button-foreground);
                            cursor: pointer;
                            font-size: 11px;
                            border-radius: 2px;
                        }
    
                        .package-item button:hover {
                            background-color: var(--vscode-button-hoverBackground);
                        }
    
                        .package-item.installed button {
                            background-color: var(--vscode-button-secondaryBackground);
                            color: var(--vscode-button-secondaryForeground);
                        }
    
                        .package-item.installed button:hover {
                            background-color: var(--vscode-button-secondaryHoverBackground);
                        }
    
                        .loading {
                            text-align: center;
                            color: var(--vscode-descriptionForeground);
                            padding: 20px;
                        }
    
                        .error {
                            text-align: center;
                            color: var(--vscode-errorForeground);
                            padding: 20px;
                        }

                        .context-info {
                            background-color: var(--vscode-panel-background);
                            border: 1px solid var(--vscode-panel-border);
                            border-radius: 4px;
                            padding: 8px 12px;
                            margin-bottom: 16px;
                            font-size: 12px;
                        }

                        .context-info p {
                            margin: 0;
                        }

                        .tabs {
                            display: flex;
                            border-bottom: 1px solid var(--vscode-panel-border);
                            margin-bottom: 16px;
                        }

                        .tab-button {
                            background: none;
                            border: none;
                            padding: 8px 16px;
                            cursor: pointer;
                            color: var(--vscode-foreground);
                            font-size: 12px;
                            border-bottom: 2px solid transparent;
                        }

                        .tab-button:hover {
                            background-color: var(--vscode-button-hoverBackground);
                        }

                        .tab-button.active {
                            border-bottom-color: var(--vscode-button-background);
                            background-color: var(--vscode-panel-background);
                        }

                        .tab-content {
                            display: none;
                        }

                        .tab-content:first-of-type {
                            display: block;
                        }

                        .results-container {
                            border: 1px solid var(--vscode-panel-border);
                            border-radius: 4px;
                            max-height: 400px;
                            overflow-y: auto;
                        }
                    </style>
                </head>
                <body>
                    <div class="nuget-manager">
                        <div class="search-section">
                            <h2>NuGet Package Manager</h2>
                            <div id="context-info" class="context-info"></div>

                            <div class="tabs">
                                <button id="tab-browse" class="tab-button active">Browse</button>
                                <button id="tab-installed" class="tab-button">Installed</button>
                                <button id="tab-updates" class="tab-button">Updates</button>
                                <button id="tab-consolidate" class="tab-button" style="display: none;">Consolidate</button>
                            </div>

                            <div id="tab-content-browse" class="tab-content">
                                <div class="search-controls">
                                    <input type="text" id="search-input" placeholder="Search packages..." />
                                    <button id="search-button">Search</button>
                                    <label>
                                        <input type="checkbox" id="include-prerelease" />
                                        Include prerelease
                                    </label>
                                </div>
                                <div id="search-results" class="results-container">
                                    <div class="loading">Enter a search term to find packages</div>
                                </div>
                            </div>

                            <div id="tab-content-installed" class="tab-content" style="display: none;">
                                <div id="installed-packages" class="results-container">
                                    <div class="loading">Loading installed packages...</div>
                                </div>
                            </div>

                            <div id="tab-content-updates" class="tab-content" style="display: none;">
                                <div id="updates-packages" class="results-container">
                                    <div class="loading">Loading package updates...</div>
                                </div>
                            </div>

                            <div id="tab-content-consolidate" class="tab-content" style="display: none;">
                                <div id="consolidate-packages" class="results-container">
                                    <div class="loading">Loading consolidation opportunities...</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script nonce="${nonce}">
                        // Initialize the NuGet Package Manager
                        let currentContext = null;
                        const vscode = acquireVsCodeApi();

                        // Tab management
                        document.querySelectorAll('.tab-button').forEach(button => {
                            button.addEventListener('click', (e) => {
                                const tabId = e.target.id.replace('tab-', '');
                                switchTab(tabId);
                            });
                        });

                        function switchTab(tabName) {
                            // Hide all tab contents
                            document.querySelectorAll('.tab-content').forEach(content => {
                                content.style.display = 'none';
                            });

                            // Remove active class from all buttons
                            document.querySelectorAll('.tab-button').forEach(button => {
                                button.classList.remove('active');
                            });

                            // Show selected tab content
                            const selectedContent = document.getElementById('tab-content-' + tabName);
                            if (selectedContent) {
                                selectedContent.style.display = 'block';
                            }

                            // Add active class to selected button
                            const selectedButton = document.getElementById('tab-' + tabName);
                            if (selectedButton) {
                                selectedButton.classList.add('active');
                            }

                            // Load data for the selected tab
                            loadTabData(tabName);
                        }

                        // Search functionality
                        document.getElementById('search-button').addEventListener('click', performSearch);
                        document.getElementById('search-input').addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') {
                                performSearch();
                            }
                        });

                        function performSearch() {
                            const query = document.getElementById('search-input').value.trim();
                            if (!query) return;

                            const includePrerelease = document.getElementById('include-prerelease').checked;

                            document.getElementById('search-results').innerHTML = '<div class="loading">Searching packages...</div>';

                            vscode.postMessage({
                                command: 'searchPackages',
                                query: query,
                                includePrerelease: includePrerelease
                            });
                        }

                        function loadTabData(tabName) {
                            switch(tabName) {
                                case 'installed':
                                    vscode.postMessage({ command: 'getInstalledPackages' });
                                    break;
                                case 'updates':
                                    vscode.postMessage({ command: 'getUpdatesPackages' });
                                    break;
                                case 'consolidate':
                                    vscode.postMessage({ command: 'getConsolidatePackages' });
                                    break;
                            }
                        }

                        // Handle messages from the extension
                        window.addEventListener('message', event => {
                            const message = event.data;

                            switch (message.command) {
                                case 'nugetData':
                                    handleNuGetData(message.data);
                                    break;
                                case 'searchResults':
                                    displaySearchResults(message.data);
                                    break;
                                case 'installedPackages':
                                    displayInstalledPackages(message.data);
                                    break;
                                case 'updatesPackages':
                                    displayUpdatesPackages(message.data);
                                    break;
                                case 'consolidatePackages':
                                    displayConsolidatePackages(message.data);
                                    break;
                            }
                        });

                        function handleNuGetData(data) {
                            currentContext = data;

                            // Update context info
                            const contextInfo = document.getElementById('context-info');
                            if (data.context === 'solution') {
                                contextInfo.innerHTML = '<p><strong>Solution:</strong> ' + (data.solutionPath || 'Unknown') + '</p>';
                                document.getElementById('tab-consolidate').style.display = 'block';
                            } else {
                                contextInfo.innerHTML = '<p><strong>Project:</strong> ' + (data.projectPath || 'Unknown') + '</p>';
                                document.getElementById('tab-consolidate').style.display = 'none';
                            }

                            // Load initial data for installed tab
                            loadTabData('installed');
                        }

                        function displaySearchResults(packages) {
                            const container = document.getElementById('search-results');
                            if (!packages || packages.length === 0) {
                                container.innerHTML = '<div class="loading">No packages found</div>';
                                return;
                            }

                            let html = '';
                            packages.forEach(pkg => {
                                html += createPackageItemHtml(pkg, 'install');
                            });
                            container.innerHTML = html;
                        }

                        function displayInstalledPackages(packages) {
                            const container = document.getElementById('installed-packages');
                            if (!packages || packages.length === 0) {
                                container.innerHTML = '<div class="loading">No packages installed</div>';
                                return;
                            }

                            let html = '';
                            packages.forEach(pkg => {
                                html += createPackageItemHtml(pkg, 'uninstall');
                            });
                            container.innerHTML = html;
                        }

                        function displayUpdatesPackages(packages) {
                            const container = document.getElementById('updates-packages');
                            if (!packages || packages.length === 0) {
                                container.innerHTML = '<div class="loading">All packages are up to date</div>';
                                return;
                            }

                            let html = '';
                            packages.forEach(pkg => {
                                html += createPackageItemHtml(pkg, 'update');
                            });
                            container.innerHTML = html;
                        }

                        function displayConsolidatePackages(packages) {
                            const container = document.getElementById('consolidate-packages');
                            if (!packages || packages.length === 0) {
                                container.innerHTML = '<div class="loading">No packages need consolidation</div>';
                                return;
                            }

                            let html = '';
                            packages.forEach(pkg => {
                                html += createConsolidationItemHtml(pkg);
                            });
                            container.innerHTML = html;
                        }

                        function createPackageItemHtml(pkg, actionType) {
                            const buttonText = actionType === 'install' ? 'Install' :
                                             actionType === 'uninstall' ? 'Uninstall' : 'Update';
                            const version = pkg.version || pkg.currentVersion || pkg.latestVersion || 'Unknown';

                            return \`
                                <div class="package-item">
                                    <div class="package-info">
                                        <h4>\${pkg.id || pkg.packageId || 'Unknown Package'}</h4>
                                        <p>\${pkg.description || 'No description available'}</p>
                                        <span class="version">Version: \${version}</span>
                                        \${pkg.authors ? '<span class="authors">By: ' + pkg.authors.join(', ') + '</span>' : ''}
                                    </div>
                                    <button onclick="performPackageAction('\${actionType}', '\${pkg.id || pkg.packageId}', '\${version}')">\${buttonText}</button>
                                </div>
                            \`;
                        }

                        function createConsolidationItemHtml(consolidationInfo) {
                            return \`
                                <div class="package-item">
                                    <div class="package-info">
                                        <h4>\${consolidationInfo.packageId}</h4>
                                        <p>Multiple versions found across projects</p>
                                        <div>
                                            \${consolidationInfo.versions.map(v =>
                                                \`<span class="version">v\${v.version} (\${v.projects.length} projects)</span>\`
                                            ).join(' ')}
                                        </div>
                                    </div>
                                    <button onclick="consolidatePackage('\${consolidationInfo.packageId}', '\${consolidationInfo.latestVersion || consolidationInfo.versions[0].version}')">Consolidate</button>
                                </div>
                            \`;
                        }

                        function performPackageAction(action, packageId, version) {
                            vscode.postMessage({
                                command: 'packageAction',
                                action: action,
                                packageId: packageId,
                                version: version
                            });
                        }

                        function consolidatePackage(packageId, version) {
                            vscode.postMessage({
                                command: 'consolidatePackage',
                                packageId: packageId,
                                version: version
                            });
                        }

                        // Request initial data
                        vscode.postMessage({ command: 'getNuGetData' });
                    </script>
                </body>
                </html>`;
    }

    private static _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}