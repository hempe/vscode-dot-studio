import React, { useEffect, useState } from 'react';
import { Panels, TextField, Button, Table, TableRow, TableCell, Checkbox, Icon } from 'vscrui';
import { VSCodeAPI, WebviewApi } from '../shared/vscode-api';
import { logger } from '../shared/logger';
import { LoadingBar, LoadingMessage } from '../shared/LoadingBar';

const nugetLogger = logger('NuGetReact');

declare global {
    interface Window {
        acquireVsCodeApi(): WebviewApi;
    }
}

const vscode = (function() {
    try {
        // Try to get the real VS Code API when running in a webview
        return window.acquireVsCodeApi();
    } catch {
        // Fallback to mock API for development/testing
        nugetLogger.info('Using fallback VSCodeAPI for development');
        return new VSCodeAPI();
    }
})();

interface NuGetPackage {
    id: string;
    version: string;
    description: string;
    authors: string;
    downloadCount?: number;
    latestVersion?: string;
    selected?: boolean;
    projectName?: string;
    projects?: { name: string; version: string }[];
}

interface NuGetViewData {
    installedPackages: NuGetPackage[];
    searchResults: NuGetPackage[];
    updatesAvailable: NuGetPackage[];
    consolidatePackages?: NuGetPackage[]; // For future consolidation functionality
    projectPath?: string;
}

export const App: React.FC = () => {
    const [data, setData] = useState<NuGetViewData>({
        installedPackages: [],
        searchResults: [],
        updatesAvailable: [],
        consolidatePackages: []
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [includePrerelease, setIncludePrerelease] = useState(false);
    const [activeTab, setActiveTab] = useState('installed');
    const [selectedPackage, setSelectedPackage] = useState<NuGetPackage | null>(null);
    const [filterTerm, setFilterTerm] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
    const [selectedVersion, setSelectedVersion] = useState('');

    // Helper function to ensure we always have a proper array
    const ensureArray = (value: any): any[] => {
        if (Array.isArray(value)) {
            return value;
        }

        // Log unexpected non-array values (excluding null/undefined which are expected)
        if (value !== null && value !== undefined) {
            nugetLogger.error('ensureArray: Expected array but received:', {
                type: typeof value,
                value: value,
                constructor: value?.constructor?.name
            });
        }

        return [];
    };

    // Helper function to deduplicate packages by ID and group project information
    const getUniquePackages = (packages: NuGetPackage[]) => {
        const packageMap = new Map<string, NuGetPackage & { projects?: { name: string; version: string }[] }>();

        packages.forEach(pkg => {
            const existing = packageMap.get(pkg.id);
            if (existing) {
                // Add project info to existing package (avoid duplicates)
                if (!existing.projects) {
                    existing.projects = [];
                }

                // Check if this project is already in the list
                const projectName = pkg.projectName || 'Unknown Project';
                const existingProject = existing.projects.find(p => p.name === projectName);

                if (!existingProject) {
                    // Only add if project not already in list
                    existing.projects.push({
                        name: projectName,
                        version: pkg.version
                    });
                } else if (pkg.version > existingProject.version) {
                    // Update to higher version if found
                    existingProject.version = pkg.version;
                }

                // Use the latest version as the display version
                if (pkg.version > existing.version) {
                    existing.version = pkg.version;
                    existing.description = pkg.description || existing.description;
                    existing.authors = pkg.authors || existing.authors;
                }
            } else {
                // First time seeing this package
                packageMap.set(pkg.id, {
                    ...pkg,
                    projects: [{
                        name: pkg.projectName || 'Unknown Project',
                        version: pkg.version
                    }]
                });
            }
        });

        return Array.from(packageMap.values());
    };

    // Helper function to filter packages based on search term
    const filterPackages = (packages: NuGetPackage[], searchTerm: string) => {
        if (!searchTerm.trim()) {
            return packages;
        }

        const term = searchTerm.toLowerCase();
        return packages.filter(pkg =>
            pkg.id.toLowerCase().includes(term) ||
            (pkg.description && pkg.description.toLowerCase().includes(term)) ||
            (pkg.authors && pkg.authors.toLowerCase().includes(term))
        );
    };

    // Helper function to format version display
    const formatVersionDisplay = (currentVersion: string | undefined, latestVersion: string | undefined) => {
        const current = currentVersion || 'Unknown';
        const latest = latestVersion || 'Unknown';

        // Handle version ranges like "[2.0.3, )" by extracting the actual version
        const cleanCurrent = current.replace(/[\[\(\),\s]/g, '').split(',')[0] || current;
        const cleanLatest = latest.replace(/[\[\(\),\s]/g, '').split(',')[0] || latest;

        return `v${cleanCurrent} → v${cleanLatest}`;
    };

    useEffect(() => {
        vscode.postMessage({ type: 'getNuGetData' });

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            nugetLogger.info('NuGet React: Received message:', message);

            switch (message.command) {
                case 'nugetData':
                    nugetLogger.info('NuGet React: Setting data to:', message.data);
                    nugetLogger.debug('NuGet React: Raw installed packages:', message.data?.installedPackages);

                    // Map backend data structure to frontend structure
                    const safeData = {
                        installedPackages: ensureArray(message.data?.installedPackages),
                        searchResults: ensureArray(message.data?.searchResults),
                        // Backend sends 'outdatedPackages' array, not 'updatesAvailable'
                        updatesAvailable: ensureArray(message.data?.outdatedPackages),
                        projectPath: message.data?.projectPath
                    };

                    nugetLogger.debug('NuGet React: Processed installed packages:', safeData.installedPackages);

                    setData(safeData);

                    // Auto-select first installed package when data loads
                    const uniquePackages = getUniquePackages(safeData.installedPackages);
                    nugetLogger.debug('NuGet React: Unique packages after deduplication:', uniquePackages);

                    if (uniquePackages.length > 0 && !selectedPackage) {
                        nugetLogger.info('NuGet React: Auto-selecting package:', uniquePackages[0]);
                        setSelectedPackage(uniquePackages[0]);
                    }

                    // Mark initialization as complete
                    setInitializing(false);
                    break;
                case 'searchResults':
                    const searchResults = message.packages || message.data;
                    nugetLogger.info('NuGet React: Setting searchResults to:', searchResults);
                    setData(prev => ({ ...prev, searchResults: ensureArray(searchResults) }));
                    setLoading(false);
                    break;
                case 'updatesAvailable':
                    nugetLogger.info('NuGet React: Setting updatesAvailable to:', message.packages);
                    nugetLogger.debug('NuGet React: Raw updatesAvailable packages:', message.packages);
                    // Log a few sample packages to debug version issues
                    if (Array.isArray(message.packages) && message.packages.length > 0) {
                        message.packages.slice(0, 3).forEach((pkg: any, idx: number) => {
                            nugetLogger.debug(`Sample update package ${idx}:`, {
                                id: pkg.id,
                                version: pkg.version,
                                latestVersion: pkg.latestVersion,
                                projectName: pkg.projectName
                            });
                        });
                    }
                    setData(prev => ({ ...prev, updatesAvailable: ensureArray(message.packages) }));
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Handle filter changes - reset selection if current package is not visible
    useEffect(() => {
        if (selectedPackage && filterTerm) {
            const uniquePackages = getUniquePackages(ensureArray(data.installedPackages));
            const filteredPackages = filterPackages(uniquePackages, filterTerm);

            // If selected package is not in filtered results, select first filtered package
            if (!filteredPackages.find(pkg => pkg.id === selectedPackage.id)) {
                setSelectedPackage(filteredPackages.length > 0 ? filteredPackages[0] : null);
            }
        }
    }, [filterTerm, data.installedPackages, selectedPackage]);

    // Reset selected projects and version when package changes
    useEffect(() => {
        setSelectedProjects(new Set());
        setSelectedVersion('');
    }, [selectedPackage?.id]);

    const handleSearch = () => {
        if (searchTerm.trim()) {
            nugetLogger.info('Frontend: Starting search for:', searchTerm, 'includePrerelease:', includePrerelease);
            setLoading(true);
            vscode.postMessage({
                type: 'searchPackages',
                payload: {
                    query: searchTerm,
                    includePrerelease: includePrerelease
                }
            });
            nugetLogger.info('Frontend: Search message sent to backend');
        }
    };

    const handleInstallPackage = (pkg: NuGetPackage) => {
        vscode.postMessage({ type: 'installPackage', payload: { package: pkg } });
    };

    const handleUninstallPackage = (pkg: NuGetPackage) => {
        vscode.postMessage({ type: 'uninstallPackage', payload: { package: pkg } });
    };

    const handleUpdatePackage = (pkg: NuGetPackage) => {
        vscode.postMessage({ type: 'updatePackage', payload: { package: pkg } });
    };

    const handleBulkUpdate = () => {
        const selectedPackages = ensureArray(data.updatesAvailable).filter(pkg => pkg.selected);
        if (selectedPackages.length > 0) {
            vscode.postMessage({ type: 'bulkUpdatePackages', payload: { packages: selectedPackages } });
        }
    };

    const handleUpdateAll = () => {
        vscode.postMessage({ type: 'updateAllPackages' });
    };

    const togglePackageSelection = (packageId: string) => {
        setData(prev => ({
            ...prev,
            updatesAvailable: ensureArray(prev.updatesAvailable).map(pkg =>
                pkg.id === packageId ? { ...pkg, selected: !pkg.selected } : pkg
            )
        }));
    };

    const tabs = [
        { id: 'browse', label: 'Browse' },
        { id: 'installed', label: 'Installed' },
        { id: 'updates', label: 'Updates' },
        { id: 'consolidate', label: 'Consolidate' }
    ];

    const browseView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Search Input */}
            <div style={{
                padding: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <TextField
                        placeholder="Search for packages..."
                        value={searchTerm}
                        onChange={setSearchTerm}
                        style={{ flex: 1 }}
                    />
                    <Button
                        onClick={handleSearch}
                        disabled={loading}
                        appearance="primary"
                    >
                        <Icon name="search" />
                        {loading ? 'Searching...' : 'Search'}
                    </Button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Checkbox
                        checked={includePrerelease}
                        onChange={setIncludePrerelease}
                    />
                    <label style={{
                        fontSize: '13px',
                        color: 'var(--vscode-foreground)',
                        cursor: 'pointer'
                    }} onClick={() => setIncludePrerelease(!includePrerelease)}>
                        Include prerelease
                    </label>
                </div>
            </div>

            {/* Two-Panel Layout */}
            <div style={{
                display: 'flex',
                flex: 1,
                border: '1px solid var(--vscode-panel-border)',
                borderTop: 'none'
            }}>
                {/* Left Panel - Package List */}
                <div style={{
                    width: '40%',
                    borderRight: '1px solid var(--vscode-panel-border)',
                    overflow: 'auto'
                }}>
                    <div style={{
                        padding: '8px 12px',
                        background: 'var(--vscode-panel-background)',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        fontSize: '12px',
                        fontWeight: 600
                    }}>
                        Browse ({getUniquePackages(ensureArray(data.searchResults)).length})
                    </div>

                    {data.searchResults.length === 0 ? (
                        <LoadingMessage
                            loading={loading}
                            message="Searching for packages..."
                            emptyMessage="Search for packages to browse"
                            searchTerm={searchTerm.trim()}
                            hasResults={false}
                        />
                    ) : (
                        getUniquePackages(ensureArray(data.searchResults)).map((pkg, index) => (
                            <div
                                key={`${pkg.id}-${pkg.version}`}
                                style={{
                                    padding: '12px',
                                    borderBottom: '1px solid var(--vscode-panel-border)',
                                    cursor: 'pointer',
                                    background: selectedPackage?.id === pkg.id
                                        ? 'var(--vscode-list-activeSelectionBackground)'
                                        : 'transparent'
                                }}
                                onClick={() => setSelectedPackage(pkg)}
                            >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                {/* Package Icon */}
                                <div style={{
                                    width: '24px',
                                    height: '24px',
                                    background: 'var(--vscode-button-background)',
                                    borderRadius: '2px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    color: 'var(--vscode-button-foreground)',
                                    flexShrink: 0
                                }}>
                                    📦
                                </div>

                                {/* Package Details */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '4px'
                                    }}>
                                        <div style={{
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            flex: 1
                                        }}>
                                            {pkg.id}
                                        </div>
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            marginLeft: '8px',
                                            flexShrink: 0
                                        }}>
                                            v{pkg.version}
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        lineHeight: '1.3',
                                        overflow: 'hidden',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical'
                                    }}>
                                        {pkg.description || 'No description available'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )))}
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                    {selectedPackage ? (
                        <div>
                            {/* Package Header */}
                            <div style={{ marginBottom: '20px' }}>
                                <h2 style={{
                                    margin: '0 0 8px 0',
                                    fontSize: '18px',
                                    fontWeight: 600
                                }}>
                                    {selectedPackage.id}
                                </h2>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '8px'
                                }}>
                                    by {selectedPackage.authors || 'Unknown'}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    lineHeight: '1.4'
                                }}>
                                    {selectedPackage.description || 'No description available'}
                                </div>
                            </div>

                            {/* Project Selection */}
                            <div style={{
                                background: 'var(--vscode-panel-background)',
                                border: '1px solid var(--vscode-panel-border)',
                                borderRadius: '4px',
                                padding: '16px',
                                marginBottom: '16px'
                            }}>
                                {/* Get all available projects - for Browse we need to show all projects from the solution */}
                                {(() => {
                                    // For Browse tab, we should show all projects from installed packages as potential targets
                                    const allProjects = new Set<string>();
                                    ensureArray(data.installedPackages).forEach(pkg => {
                                        if (pkg.projects) {
                                            pkg.projects.forEach((p: { name: string; version: string }) => allProjects.add(p.name));
                                        }
                                    });

                                    const projectList = Array.from(allProjects).map(projectName => {
                                        // Check if this project already has the selected package installed
                                        const existingInstall = ensureArray(data.installedPackages)
                                            .find(pkg => pkg.id === selectedPackage.id && pkg.projects?.some((p: { name: string; version: string }) => p.name === projectName));

                                        return {
                                            name: projectName,
                                            version: existingInstall?.projects?.find((p: { name: string; version: string }) => p.name === projectName)?.version || null
                                        };
                                    });

                                    return projectList.map((project, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '8px 0',
                                            borderBottom: idx < projectList.length - 1
                                                ? '1px solid var(--vscode-panel-border)'
                                                : 'none'
                                        }}>
                                            <Checkbox
                                                checked={selectedProjects.has(project.name)}
                                                onChange={() => {
                                                    const newSelected = new Set(selectedProjects);
                                                    if (newSelected.has(project.name)) {
                                                        newSelected.delete(project.name);
                                                    } else {
                                                        newSelected.add(project.name);
                                                    }
                                                    setSelectedProjects(newSelected);
                                                }}
                                            />
                                            <div style={{
                                                marginLeft: '8px',
                                                flex: 1,
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <div style={{ fontSize: '13px' }}>
                                                    {project.name}
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    marginLeft: '8px',
                                                    flexShrink: 0
                                                }}>
                                                    {project.version ? `v${project.version}` : 'Not installed'}
                                                </div>
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>

                            {/* Install Action */}
                            <div style={{
                                background: 'var(--vscode-panel-background)',
                                border: '1px solid var(--vscode-panel-border)',
                                borderRadius: '4px',
                                padding: '16px',
                                marginBottom: '16px'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        flex: 1
                                    }}>
                                        <div style={{
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Version:
                                        </div>
                                        <TextField
                                            value={selectedVersion || selectedPackage.version}
                                            onChange={setSelectedVersion}
                                            placeholder="Select version"
                                            style={{ flex: 1, maxWidth: '200px' }}
                                        />
                                    </div>
                                    <Button
                                        appearance="primary"
                                        disabled={selectedProjects.size === 0}
                                        onClick={() => {
                                            nugetLogger.info('Install action from Browse:', {
                                                package: selectedPackage.id,
                                                version: selectedVersion || selectedPackage.version,
                                                projects: Array.from(selectedProjects)
                                            });
                                            handleInstallPackage(selectedPackage);
                                        }}
                                    >
                                        Install
                                    </Button>
                                </div>

                                {selectedProjects.size === 0 && (
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        marginTop: '12px',
                                        fontStyle: 'italic'
                                    }}>
                                        Select one or more projects to install to
                                    </div>
                                )}
                            </div>

                            {/* Additional Package Info */}
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)'
                            }}>
                                <div style={{ marginBottom: '4px' }}>
                                    <strong>Latest Version:</strong> {selectedPackage.version}
                                </div>
                                {selectedPackage.authors && (
                                    <div style={{ marginBottom: '4px' }}>
                                        <strong>Authors:</strong> {selectedPackage.authors}
                                    </div>
                                )}
                                {selectedPackage.downloadCount && (
                                    <div style={{ marginBottom: '4px' }}>
                                        <strong>Downloads:</strong> {selectedPackage.downloadCount.toLocaleString()}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--vscode-descriptionForeground)',
                            fontSize: '14px'
                        }}>
                            {getUniquePackages(ensureArray(data.searchResults)).length === 0 ? 'Search for packages to browse' : 'Select a package to view details'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const installedView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Search/Filter Input */}
            <div style={{
                padding: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <TextField
                    placeholder="Search packages..."
                    value={filterTerm}
                    onChange={setFilterTerm}
                    style={{ width: '100%' }}
                />
            </div>

            {/* Two-Panel Layout */}
            <div style={{
                display: 'flex',
                flex: 1,
                border: '1px solid var(--vscode-panel-border)',
                borderTop: 'none'
            }}>
                {/* Left Panel - Package List */}
                <div style={{
                    width: '40%',
                    borderRight: '1px solid var(--vscode-panel-border)',
                    overflow: 'auto'
                }}>
                    <div style={{
                        padding: '8px 12px',
                        background: 'var(--vscode-panel-background)',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        fontSize: '12px',
                        fontWeight: 600
                    }}>
                        Installed ({filterPackages(getUniquePackages(ensureArray(data.installedPackages)), filterTerm).length})
                    </div>

                    {filterPackages(getUniquePackages(ensureArray(data.installedPackages)), filterTerm).map((pkg, index) => (
                    <div
                        key={`${pkg.id}-${pkg.version}`}
                        style={{
                            padding: '12px',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            cursor: 'pointer',
                            background: selectedPackage?.id === pkg.id
                                ? 'var(--vscode-list-activeSelectionBackground)'
                                : 'transparent'
                        }}
                        onClick={() => setSelectedPackage(pkg)}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            {/* Package Icon */}
                            <div style={{
                                width: '24px',
                                height: '24px',
                                background: 'var(--vscode-button-background)',
                                borderRadius: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                color: 'var(--vscode-button-foreground)',
                                flexShrink: 0
                            }}>
                                📦
                            </div>

                            {/* Package Details */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '4px'
                                }}>
                                    <div style={{
                                        fontWeight: 600,
                                        fontSize: '13px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        flex: 1
                                    }}>
                                        {pkg.id}
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        marginLeft: '8px',
                                        flexShrink: 0
                                    }}>
                                        v{pkg.version}
                                    </div>
                                </div>
                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    lineHeight: '1.3',
                                    overflow: 'hidden',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical'
                                }}>
                                    {pkg.description || 'No description available'}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                {selectedPackage ? (
                    <div>
                        {/* Package Header */}
                        <div style={{ marginBottom: '20px' }}>
                            <h2 style={{
                                margin: '0 0 8px 0',
                                fontSize: '18px',
                                fontWeight: 600
                            }}>
                                {selectedPackage.id}
                            </h2>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                marginBottom: '8px'
                            }}>
                                by {selectedPackage.authors || 'Unknown'}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                lineHeight: '1.4'
                            }}>
                                {selectedPackage.description || 'No description available'}
                            </div>
                        </div>

                        {/* Project Selection */}
                        {selectedPackage.projects && selectedPackage.projects.length > 0 && (
                            <div style={{
                                background: 'var(--vscode-panel-background)',
                                border: '1px solid var(--vscode-panel-border)',
                                borderRadius: '4px',
                                padding: '16px',
                                marginBottom: '16px'
                            }}>
                                {selectedPackage.projects.map((project, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '8px 0',
                                        borderBottom: idx < selectedPackage.projects!.length - 1
                                            ? '1px solid var(--vscode-panel-border)'
                                            : 'none'
                                    }}>
                                        <Checkbox
                                            checked={selectedProjects.has(project.name)}
                                            onChange={() => {
                                                const newSelected = new Set(selectedProjects);
                                                if (newSelected.has(project.name)) {
                                                    newSelected.delete(project.name);
                                                } else {
                                                    newSelected.add(project.name);
                                                }
                                                setSelectedProjects(newSelected);
                                            }}
                                        />
                                        <div style={{
                                            marginLeft: '8px',
                                            flex: 1,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div style={{ fontSize: '13px' }}>
                                                {project.name}
                                            </div>
                                            <div style={{
                                                fontSize: '11px',
                                                color: 'var(--vscode-descriptionForeground)',
                                                marginLeft: '8px',
                                                flexShrink: 0
                                            }}>
                                                v{project.version}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Version Selection and Actions */}
                        <div style={{
                            background: 'var(--vscode-panel-background)',
                            border: '1px solid var(--vscode-panel-border)',
                            borderRadius: '4px',
                            padding: '16px',
                            marginBottom: '16px'
                        }}>
                            {/* Installed Section */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '16px',
                                paddingBottom: '12px',
                                borderBottom: '1px solid var(--vscode-panel-border)'
                            }}>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600
                                }}>
                                    Installed: {(() => {
                                        const selectedProjectsList = Array.from(selectedProjects);
                                        if (selectedProjectsList.length === 0) return 'Select projects';

                                        const installedVersions = selectedProjectsList
                                            .map(projectName => selectedPackage.projects?.find(p => p.name === projectName)?.version)
                                            .filter(Boolean);

                                        if (installedVersions.length === 0) return 'Not installed';
                                        if (new Set(installedVersions).size === 1) return `v${installedVersions[0]}`;
                                        return 'Multiple versions';
                                    })()}
                                </div>
                                <Button
                                    disabled={selectedProjects.size === 0 || !selectedPackage.projects?.some(p => selectedProjects.has(p.name))}
                                    onClick={() => {
                                        nugetLogger.info('Uninstall action:', {
                                            package: selectedPackage.id,
                                            projects: Array.from(selectedProjects)
                                        });
                                    }}
                                >
                                    Uninstall
                                </Button>
                            </div>

                            {/* Version Section */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '12px'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flex: 1
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        whiteSpace: 'nowrap'
                                    }}>
                                        Version:
                                    </div>
                                    <TextField
                                        value={selectedVersion || selectedPackage.version}
                                        onChange={setSelectedVersion}
                                        placeholder="Select version"
                                        style={{ flex: 1, maxWidth: '200px' }}
                                    />
                                </div>
                                <Button
                                    appearance="primary"
                                    disabled={selectedProjects.size === 0}
                                    onClick={() => {
                                        nugetLogger.info('Install/Update action:', {
                                            package: selectedPackage.id,
                                            version: selectedVersion || selectedPackage.version,
                                            projects: Array.from(selectedProjects)
                                        });
                                    }}
                                >
                                    {selectedPackage.projects?.some(p => selectedProjects.has(p.name)) ? 'Update' : 'Install'}
                                </Button>
                            </div>

                            {selectedProjects.size === 0 && (
                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginTop: '12px',
                                    fontStyle: 'italic'
                                }}>
                                    Select one or more projects to perform actions
                                </div>
                            )}
                        </div>

                        {/* Additional Package Info */}
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            <div style={{ marginBottom: '4px' }}>
                                <strong>Latest Version:</strong> {selectedPackage.version}
                            </div>
                            {selectedPackage.authors && (
                                <div style={{ marginBottom: '4px' }}>
                                    <strong>Authors:</strong> {selectedPackage.authors}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--vscode-descriptionForeground)',
                        fontSize: '14px'
                    }}>
                        Select a package to view details
                    </div>
                )}
                </div>
            </div>
        </div>
    );

    const updatesView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Filter/Search Input */}
            <div style={{
                padding: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <TextField
                        placeholder="Search packages..."
                        value={filterTerm}
                        onChange={setFilterTerm}
                        style={{ flex: 1 }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                        onClick={() => {
                            const filteredPackages = filterPackages(getUniquePackages(ensureArray(data.updatesAvailable)), filterTerm);
                            // Toggle selection: if all filtered packages are selected, deselect all; otherwise select all
                            const allFilteredSelected = filteredPackages.every(pkg => pkg.selected);
                            filteredPackages.forEach(pkg => {
                                if (allFilteredSelected && pkg.selected) {
                                    togglePackageSelection(pkg.id);
                                } else if (!allFilteredSelected && !pkg.selected) {
                                    togglePackageSelection(pkg.id);
                                }
                            });
                        }}
                        disabled={filterPackages(getUniquePackages(ensureArray(data.updatesAvailable)), filterTerm).length === 0}
                    >
                        {(() => {
                            const filteredPackages = filterPackages(getUniquePackages(ensureArray(data.updatesAvailable)), filterTerm);
                            const allFilteredSelected = filteredPackages.every(pkg => pkg.selected);
                            return allFilteredSelected ? 'Deselect All' : 'Select All';
                        })()}
                    </Button>
                    <Button onClick={handleBulkUpdate} appearance="primary" disabled={!ensureArray(data.updatesAvailable).some(pkg => pkg.selected)}>
                        Update Selected
                    </Button>
                    <Button onClick={handleUpdateAll}>
                        Update All
                    </Button>
                </div>
            </div>

            {/* Two-Panel Layout */}
            <div style={{
                display: 'flex',
                flex: 1,
                border: '1px solid var(--vscode-panel-border)',
                borderTop: 'none'
            }}>
                {/* Left Panel - Package List */}
                <div style={{
                    width: '40%',
                    borderRight: '1px solid var(--vscode-panel-border)',
                    overflow: 'auto'
                }}>
                    <div style={{
                        padding: '8px 12px',
                        background: 'var(--vscode-panel-background)',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        fontSize: '12px',
                        fontWeight: 600
                    }}>
                        Updates ({filterPackages(getUniquePackages(ensureArray(data.updatesAvailable)), filterTerm).length})
                    </div>

                    {filterPackages(getUniquePackages(ensureArray(data.updatesAvailable)), filterTerm).map((pkg, index) => (
                        <div
                            key={`${pkg.id}-${pkg.version}`}
                            style={{
                                padding: '12px',
                                borderBottom: '1px solid var(--vscode-panel-border)',
                                cursor: 'pointer',
                                background: selectedPackage?.id === pkg.id
                                    ? 'var(--vscode-list-activeSelectionBackground)'
                                    : 'transparent'
                            }}
                            onClick={() => setSelectedPackage(pkg)}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                {/* Selection Checkbox */}
                                <Checkbox
                                    checked={pkg.selected || false}
                                    onChange={(checked) => {
                                        togglePackageSelection(pkg.id);
                                    }}
                                    style={{ marginTop: '2px' }}
                                    onClick={(e) => e.stopPropagation()}
                                />

                                {/* Package Icon */}
                                <div style={{
                                    width: '24px',
                                    height: '24px',
                                    background: 'var(--vscode-button-background)',
                                    borderRadius: '2px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    color: 'var(--vscode-button-foreground)',
                                    flexShrink: 0
                                }}>
                                    📦
                                </div>

                                {/* Package Details */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '4px'
                                    }}>
                                        <div style={{
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            flex: 1
                                        }}>
                                            {pkg.id}
                                        </div>
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            marginLeft: '8px',
                                            flexShrink: 0
                                        }}>
                                            {formatVersionDisplay(pkg.version, pkg.latestVersion)}
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        lineHeight: '1.3',
                                        overflow: 'hidden',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical'
                                    }}>
                                        {pkg.description || 'No description available'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                    {selectedPackage ? (
                        <div>
                            {/* Package Header */}
                            <div style={{ marginBottom: '20px' }}>
                                <h2 style={{
                                    margin: '0 0 8px 0',
                                    fontSize: '18px',
                                    fontWeight: 600
                                }}>
                                    {selectedPackage.id}
                                </h2>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '8px'
                                }}>
                                    by {selectedPackage.authors || 'Unknown'}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    lineHeight: '1.4'
                                }}>
                                    {selectedPackage.description || 'No description available'}
                                </div>
                            </div>

                            {/* Project Selection - for Updates, show projects that have this package */}
                            {selectedPackage.projects && selectedPackage.projects.length > 0 && (
                                <div style={{
                                    background: 'var(--vscode-panel-background)',
                                    border: '1px solid var(--vscode-panel-border)',
                                    borderRadius: '4px',
                                    padding: '16px',
                                    marginBottom: '16px'
                                }}>
                                    {selectedPackage.projects.map((project, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '8px 0',
                                            borderBottom: idx < selectedPackage.projects!.length - 1
                                                ? '1px solid var(--vscode-panel-border)'
                                                : 'none'
                                        }}>
                                            <Checkbox
                                                checked={selectedProjects.has(project.name)}
                                                onChange={() => {
                                                    const newSelected = new Set(selectedProjects);
                                                    if (newSelected.has(project.name)) {
                                                        newSelected.delete(project.name);
                                                    } else {
                                                        newSelected.add(project.name);
                                                    }
                                                    setSelectedProjects(newSelected);
                                                }}
                                            />
                                            <div style={{
                                                marginLeft: '8px',
                                                flex: 1,
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <div style={{ fontSize: '13px' }}>
                                                    {project.name}
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    marginLeft: '8px',
                                                    flexShrink: 0
                                                }}>
                                                    {formatVersionDisplay(project.version, selectedPackage.latestVersion)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Update Action */}
                            <div style={{
                                background: 'var(--vscode-panel-background)',
                                border: '1px solid var(--vscode-panel-border)',
                                borderRadius: '4px',
                                padding: '16px',
                                marginBottom: '16px'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        flex: 1
                                    }}>
                                        <div style={{
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Update to:
                                        </div>
                                        <TextField
                                            value={selectedVersion || selectedPackage.latestVersion}
                                            onChange={setSelectedVersion}
                                            placeholder="Select version"
                                            style={{ flex: 1, maxWidth: '200px' }}
                                        />
                                    </div>
                                    <Button
                                        appearance="primary"
                                        disabled={selectedProjects.size === 0}
                                        onClick={() => {
                                            nugetLogger.info('Update action:', {
                                                package: selectedPackage.id,
                                                version: selectedVersion || selectedPackage.latestVersion,
                                                projects: Array.from(selectedProjects)
                                            });
                                            handleUpdatePackage(selectedPackage);
                                        }}
                                    >
                                        Update
                                    </Button>
                                </div>

                                {selectedProjects.size === 0 && (
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        marginTop: '12px',
                                        fontStyle: 'italic'
                                    }}>
                                        Select one or more projects to update
                                    </div>
                                )}
                            </div>

                            {/* Additional Package Info */}
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)'
                            }}>
                                <div style={{ marginBottom: '4px' }}>
                                    <strong>Current Version:</strong> {selectedPackage.version}
                                </div>
                                <div style={{ marginBottom: '4px' }}>
                                    <strong>Latest Version:</strong> {selectedPackage.latestVersion}
                                </div>
                                {selectedPackage.authors && (
                                    <div style={{ marginBottom: '4px' }}>
                                        <strong>Authors:</strong> {selectedPackage.authors}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--vscode-descriptionForeground)',
                            fontSize: '14px'
                        }}>
                            Select a package to view update details
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const consolidateView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Filter Input */}
            <div style={{
                padding: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <TextField
                    placeholder="Search packages to consolidate..."
                    value={filterTerm}
                    onChange={setFilterTerm}
                    style={{ width: '100%' }}
                />
            </div>

            {/* Two-Panel Layout */}
            <div style={{
                display: 'flex',
                flex: 1,
                border: '1px solid var(--vscode-panel-border)',
                borderTop: 'none'
            }}>
                {/* Left Panel - Package List */}
                <div style={{
                    width: '40%',
                    borderRight: '1px solid var(--vscode-panel-border)',
                    overflow: 'auto'
                }}>
                    <div style={{
                        padding: '8px 12px',
                        background: 'var(--vscode-panel-background)',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        fontSize: '12px',
                        fontWeight: 600
                    }}>
                        Consolidate ({filterPackages(getUniquePackages(ensureArray(data.consolidatePackages)), filterTerm).length})
                    </div>

                    {filterPackages(getUniquePackages(ensureArray(data.consolidatePackages)), filterTerm).length === 0 ? (
                        <div style={{
                            padding: '20px',
                            textAlign: 'center',
                            color: 'var(--vscode-descriptionForeground)',
                            fontSize: '12px'
                        }}>
                            No packages need consolidation
                        </div>
                    ) : (
                        filterPackages(getUniquePackages(ensureArray(data.consolidatePackages)), filterTerm).map((pkg, index) => (
                            <div
                                key={`${pkg.id}-${pkg.version}`}
                                style={{
                                    padding: '12px',
                                    borderBottom: '1px solid var(--vscode-panel-border)',
                                    cursor: 'pointer',
                                    background: selectedPackage?.id === pkg.id
                                        ? 'var(--vscode-list-activeSelectionBackground)'
                                        : 'transparent'
                                }}
                                onClick={() => setSelectedPackage(pkg)}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                    {/* Package Icon */}
                                    <div style={{
                                        width: '24px',
                                        height: '24px',
                                        background: 'var(--vscode-button-background)',
                                        borderRadius: '2px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '12px',
                                        color: 'var(--vscode-button-foreground)',
                                        flexShrink: 0
                                    }}>
                                        📦
                                    </div>

                                    {/* Package Details */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '4px'
                                        }}>
                                            <div style={{
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                flex: 1
                                            }}>
                                                {pkg.id}
                                            </div>
                                            <div style={{
                                                fontSize: '11px',
                                                color: 'var(--vscode-descriptionForeground)',
                                                marginLeft: '8px',
                                                flexShrink: 0
                                            }}>
                                                Multiple versions
                                            </div>
                                        </div>
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            lineHeight: '1.3',
                                            overflow: 'hidden',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical'
                                        }}>
                                            {pkg.description || 'No description available'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                    )))}
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--vscode-descriptionForeground)',
                        fontSize: '14px',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        <div style={{ fontSize: '16px', fontWeight: 600 }}>
                            Consolidate Packages
                        </div>
                        <div style={{ textAlign: 'center', lineHeight: '1.4' }}>
                            The Consolidate tab helps you manage packages that are installed
                            in multiple projects with different versions. When packages need
                            consolidation, they will appear here for easy version alignment
                            across your solution.
                        </div>
                        <div style={{
                            background: 'var(--vscode-panel-background)',
                            border: '1px solid var(--vscode-panel-border)',
                            borderRadius: '4px',
                            padding: '16px',
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            <strong>Coming soon:</strong> Advanced consolidation features including
                            version conflict detection and resolution recommendations.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const views = [
        { id: 'browse', content: browseView },
        { id: 'installed', content: installedView },
        { id: 'updates', content: updatesView },
        { id: 'consolidate', content: consolidateView }
    ];

    const shouldShowLoadingBar = loading || initializing;

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <LoadingBar visible={shouldShowLoadingBar} />
            <Panels
                tabs={tabs}
                views={views}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
};