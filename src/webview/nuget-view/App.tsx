import React, { useEffect, useState } from 'react';
import { VSCodeAPI, WebviewApi } from '../shared/vscode-api';

declare global {
    interface Window {
        acquireVsCodeApi(): WebviewApi;
    }
}

const vscode = new VSCodeAPI();

interface NuGetPackage {
    id: string;
    version: string;
    description: string;
    authors: string;
    downloadCount?: number;
}

interface NuGetViewData {
    installedPackages: NuGetPackage[];
    searchResults: NuGetPackage[];
    projectPath?: string;
}

export const App: React.FC = () => {
    const [data, setData] = useState<NuGetViewData>({ installedPackages: [], searchResults: [] });
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Request initial data
        vscode.postMessage({ type: 'getNuGetData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'nugetData':
                    setData(message.data);
                    break;
                case 'searchResults':
                    setData(prev => ({ ...prev, searchResults: message.packages }));
                    setLoading(false);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleSearch = () => {
        if (searchTerm.trim()) {
            setLoading(true);
            vscode.postMessage({ type: 'searchPackages', payload: { query: searchTerm } });
        }
    };

    const handleInstallPackage = (pkg: NuGetPackage) => {
        vscode.postMessage({ type: 'installPackage', payload: { package: pkg } });
    };

    const handleUninstallPackage = (pkg: NuGetPackage) => {
        vscode.postMessage({ type: 'uninstallPackage', payload: { package: pkg } });
    };

    return (
        <div className="nuget-manager">
            <div className="search-section">
                <div className="search-controls">
                    <input
                        type="text"
                        placeholder="Search for packages..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <button onClick={handleSearch} disabled={loading}>
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                </div>

                <div className="search-results">
                    <h3>Browse</h3>
                    {data.searchResults.map(pkg => (
                        <div key={`${pkg.id}-${pkg.version}`} className="package-item">
                            <div className="package-info">
                                <h4>{pkg.id}</h4>
                                <p>{pkg.description}</p>
                                <span className="version">v{pkg.version}</span>
                                <span className="authors">by {pkg.authors}</span>
                            </div>
                            <button onClick={() => handleInstallPackage(pkg)}>
                                Install
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="installed-section">
                <h3>Installed</h3>
                {data.installedPackages.map(pkg => (
                    <div key={`${pkg.id}-${pkg.version}`} className="package-item installed">
                        <div className="package-info">
                            <h4>{pkg.id}</h4>
                            <span className="version">v{pkg.version}</span>
                        </div>
                        <button onClick={() => handleUninstallPackage(pkg)}>
                            Uninstall
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};