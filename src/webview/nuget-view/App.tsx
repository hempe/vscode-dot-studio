import React, { useEffect, useState } from 'react';
import { Panels, TextField, Button, Table, TableRow, TableCell, Checkbox, Icon, Dropdown } from 'vscrui';
import { VSCodeAPI, WebviewApi } from '../shared/vscode-api';
import { logger } from '../shared/logger';
import { LoadingBar, LoadingMessage } from '../shared/LoadingBar';
import NugetReadme from './components/NugetReadme';
import NugetDetail from './components/NugetDetail';
import { ensureArray, formatAuthors, LocalNuGetPackage } from './shared';
import NugetDetails from './components/NugetDetails';
import NugetHeader from './components/NugetHeader';
import ProjectList from './components/ProjectList';
import { PackageList } from './components/PackageList';

const log = logger('NuGetReact');

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
        log.info('Using fallback VSCodeAPI for development');
        return new VSCodeAPI();
    }
})();

interface NuGetViewData {
    installedPackages: LocalNuGetPackage[];
    searchResults: LocalNuGetPackage[];
    updatesAvailable: LocalNuGetPackage[];
    consolidatePackages?: LocalNuGetPackage[]; // For future consolidation functionality
    projects?: { name: string; path: string, version: string }[];
    projectPath?: string;
}


// Helper function to deduplicate packages by ID and group project information
const getUniquePackages = (packages: LocalNuGetPackage[], projects: { name: string; path: string, version: string }[]) => {
    const packageMap = new Map<string, LocalNuGetPackage>();

    packages.forEach(pkg => {
        const existing = packageMap.get(pkg.id);
        const existingProject = projects.find(p => p.name === pkg.projectName);

        if (existing) {
            // Add project info to existing package (avoid duplicates)
            if (!existing.projects) existing.projects = [];
            if (!existingProject) return;
            existing.projects.push({ name: existingProject.name, version: existingProject.version });
        } else {
            // First time seeing this package
            packageMap.set(pkg.id, {
                ...pkg,
                projects: existingProject ? [{name:existingProject.name, version:existingProject.version}]:[]
            });
        }
    });

    return Array.from(packageMap.values());
};

export const App: React.FC = () => {
    const [data, setData] = useState<NuGetViewData>({
        installedPackages: [],
        searchResults: [],
        updatesAvailable: [],
        consolidatePackages: []
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [hasSearched, setHasSearched] = useState(false);
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [includePrerelease, setIncludePrerelease] = useState(false);
    const [activeTab, setActiveTab] = useState('installed');
    const [selectedPackage, setSelectedPackage] = useState<LocalNuGetPackage | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const [filterTerm, setFilterTerm] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
    const [selectedVersion, setSelectedVersion] = useState('');
    const selectedItemRef = React.useRef<HTMLDivElement>(null);
    const [packageIcons, setPackageIcons] = useState<Map<string, string>>(new Map());
    const [requestedIcons, setRequestedIcons] = useState<Set<string>>(new Set());
    const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());
    const [packageReadmes, setPackageReadmes] = useState<Map<string, string>>(new Map());
    const [requestedReadmes, setRequestedReadmes] = useState<Set<string>>(new Set());

    // Helper function to filter packages based on search term
    const filterPackages = (packages: LocalNuGetPackage[], searchTerm: string) => {
        if (!searchTerm.trim()) {
            return packages;
        }

        const term = searchTerm.toLowerCase();
        return packages.filter(pkg =>
            pkg.id.toLowerCase().includes(term) ||
            (pkg.description && pkg.description.toLowerCase().includes(term)) ||
            formatAuthors(pkg.authors).toLowerCase().includes(term)
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

    // Helper function to get version change text for Updates tab
    const getVersionChangeText = (pkg: LocalNuGetPackage): string => {
        return formatVersionDisplay(pkg.version, pkg.latestVersion);
    };

    // Compute filtered package lists
    const filteredPackages = filterPackages(ensureArray(data.installedPackages), filterTerm);
    const filteredUpdates = filterPackages(ensureArray(data.updatesAvailable), filterTerm);

    useEffect(() => {
        vscode.postMessage({ type: 'getNuGetData' });

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            log.info('NuGet React: Received message:', message);

            switch (message.command) {
                case 'nugetData':
                    log.info('NuGet React: Setting data to:', message.data);
                    log.debug('NuGet React: Raw installed packages:', message.data?.installedPackages);

                    // Map backend data structure to frontend structure
                    const safeData = {
                        installedPackages: getUniquePackages(ensureArray(message.data?.installedPackages), message.data?.projects || []),
                        searchResults: getUniquePackages(ensureArray(message.data?.searchResults), message.data?.projects || []),
                        // Backend sends 'outdatedPackages' array, not 'updatesAvailable'
                        updatesAvailable: getUniquePackages(ensureArray(message.data?.outdatedPackages), message.data?.projects || []),
                        projects: ensureArray(message.data?.projects),
                        projectPath: message.data?.projectPath
                    };

                    log.debug('NuGet React: Processed installed packages:', safeData.installedPackages);

                    setData(safeData);

                    // Auto-select first installed package when data loads
                    const uniquePackages = safeData.installedPackages;
                    log.debug('NuGet React: Unique packages after deduplication:', uniquePackages);

                    if (uniquePackages.length > 0 && !selectedPackage) {
                        log.info('NuGet React: Auto-selecting package:', uniquePackages[0]);
                        setSelectedPackage(uniquePackages[0]);
                    }

                    // Mark initialization as complete
                    setInitializing(false);
                    break;
                case 'searchResults':
                    const searchResults = message.packages || message.data;
                    log.info('NuGet React: Setting searchResults to:', searchResults);
                    setData(prev => ({ ...prev, searchResults: ensureArray(searchResults) }));
                    setLoading(false);
                    setHasSearched(true);
                    break;
                case 'updatesAvailable':
                    log.info('NuGet React: Setting updatesAvailable to:', message.packages);
                    log.debug('NuGet React: Raw updatesAvailable packages:', message.packages);
                    // Log a few sample packages to debug version issues
                    if (Array.isArray(message.packages) && message.packages.length > 0) {
                        message.packages.slice(0, 3).forEach((pkg: any, idx: number) => {
                            log.debug(`Sample update package ${idx}:`, {
                                id: pkg.id,
                                version: pkg.version,
                                latestVersion: pkg.latestVersion,
                                projectName: pkg.projectName
                            });
                        });
                    }
                    setData(prev => ({ ...prev, updatesAvailable: ensureArray(message.packages) }));
                    break;
                case 'packageDetails':
                    log.info('NuGet React: Received package details:', message.package);
                    if (message.package && selectedPackage && selectedPackage.id === message.package.id) {
                        // Update the selected package with detailed metadata
                        setSelectedPackage({
                            ...selectedPackage,
                            ...message.package
                        });
                        log.info('NuGet React: Updated selected package with details');
                    }
                    break;
                case 'packageIcon':
                    if (message.packageId && message.version) {
                        const iconKey = `${message.packageId}@${message.version}`;
                        const packageKey = message.packageId.toLowerCase(); // Use only package ID for caching

                        if (message.iconUri) {
                            setPackageIcons(prev => {
                                const newMap = new Map(prev);
                                newMap.set(packageKey, message.iconUri);
                                return newMap;
                            });
                            log.info(`Icon received for ${iconKey}: success`);
                        } else {
                            // Mark this package as having no icon to avoid future requests
                            setFailedIcons(prev => new Set(prev).add(packageKey));
                            log.info(`Icon failed for ${iconKey} - won't retry`);
                        }
                    }
                    break;
                case 'packageReadme':
                    if (message.packageId && message.version) {
                        const readmeKey = `${message.packageId}@${message.version}`;
                        const packageKey = message.packageId.toLowerCase();

                        if (message.readmeUrl) {
                            setPackageReadmes(prev => {
                                const newMap = new Map(prev);
                                newMap.set(packageKey, message.readmeUrl);
                                return newMap;
                            });
                            log.info(`README URL received for ${readmeKey}: ${message.readmeUrl}`);
                        } else {
                            log.info(`README not available for ${readmeKey}`);
                        }
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Handle filter changes - reset selection if current package is not visible
    useEffect(() => {
        if (selectedPackage && filterTerm) {
            const uniquePackages = ensureArray(data.installedPackages);
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

    // Batch load icons and READMEs when packages are available
    useEffect(() => {
        const packagesToLoad = activeTab === 'browse'
            ? ensureArray(data.searchResults)
            : ensureArray(data.installedPackages);

        packagesToLoad.forEach((pkg) => {
            requestPackageIcon(pkg);
            requestPackageReadme(pkg);
        });
    }, [data.searchResults, data.installedPackages, activeTab, packageIcons, requestedIcons, failedIcons, packageReadmes, requestedReadmes]);

    const handleSearch = () => {
        if (searchTerm.trim()) {
            log.info('Frontend: Starting search for:', searchTerm, 'includePrerelease:', includePrerelease);
            setLoading(true);
            vscode.postMessage({
                type: 'searchPackages',
                payload: {
                    query: searchTerm,
                    includePrerelease: includePrerelease
                }
            });
            log.info('Frontend: Search message sent to backend');
        }
    };

    const handleInstallPackage = (pkg: LocalNuGetPackage) => {
        vscode.postMessage({ type: 'installPackage', payload: { package: pkg } });
    };

    const handleUninstallPackage = (pkg: LocalNuGetPackage) => {
        vscode.postMessage({ type: 'uninstallPackage', payload: { package: pkg } });
    };

    const handleUpdatePackage = (pkg: LocalNuGetPackage) => {
        vscode.postMessage({ type: 'updatePackage', payload: { package: pkg } });
    };

    // Helper function to get package icon URL
    const getPackageIconUrl = (pkg: LocalNuGetPackage): string => {
        const packageKey = pkg.id.toLowerCase();
        return packageIcons.get(packageKey) || '';
    };

    // Helper function to request package icon from backend
    const requestPackageIcon = (pkg: LocalNuGetPackage): void => {
        const packageKey = pkg.id.toLowerCase();

        // Skip if we already have the icon, already requested it, or know it failed
        if (packageIcons.has(packageKey) ||
            requestedIcons.has(packageKey) ||
            failedIcons.has(packageKey) ||
            !isNuGetOrgPackage(pkg)) {
            return;
        }

        // Mark as requested to prevent duplicates
        setRequestedIcons(prev => new Set(prev).add(packageKey));

        vscode.postMessage({
            type: 'getPackageIcon',
            payload: {
                packageId: pkg.id,
                version: pkg.version
            }
        });
    };

    // Helper function to request package README from backend
    const requestPackageReadme = (pkg: LocalNuGetPackage): void => {
        const packageKey = pkg.id.toLowerCase();

        // Skip if we already have the README or already requested it
        if (packageReadmes.has(packageKey) ||
            requestedReadmes.has(packageKey) ||
            !isNuGetOrgPackage(pkg)) {
            return;
        }

        // Mark as requested to prevent duplicates
        setRequestedReadmes(prev => new Set(prev).add(packageKey));

        vscode.postMessage({
            type: 'getPackageReadme',
            payload: {
                packageId: pkg.id,
                version: pkg.version
            }
        });
    };

    // Helper function to determine if package is from NuGet.org
    const isNuGetOrgPackage = (pkg: LocalNuGetPackage): boolean => {
        // Check if source information is available
        if (pkg.source) {
            // Check for NuGet.org URLs (both V2 and V3)
            const nugetOrgUrls = [
                'https://api.nuget.org/v3/index.json',
                'https://www.nuget.org/api/v2',
                'https://api.nuget.org/v3',
                'nuget.org'
            ];

            const source = pkg.source.toLowerCase();
            return nugetOrgUrls.some(url => source.includes(url.toLowerCase()));
        }

        // Fallback: assume NuGet.org if no source information
        // Most packages without explicit source info are likely from NuGet.org
        return true;
    };

    // Helper function to enhance search results with installed package information
    const enhanceWithInstalledInfo = (searchResults: LocalNuGetPackage[], installedPackages: LocalNuGetPackage[]): LocalNuGetPackage[] => {
        // Group installed packages by ID and create projects array
        const installedMap = new Map<string, LocalNuGetPackage>();
        const projectsMap = new Map<string, {name: string, version: string}[]>();

        ensureArray(installedPackages).forEach(pkg => {
            const key = pkg.id.toLowerCase();


            // Store the package info
            if (!installedMap.has(key)) {
                installedMap.set(key, pkg);
            }

            // Build projects array
            if (!projectsMap.has(key)) {
                projectsMap.set(key, []);
            }

            // Add project info (from individual package entry format)
            if (pkg.projectName) {
                const projects = projectsMap.get(key)!;
                // Avoid duplicates
                const exists = projects.find(p => p.name === pkg.projectName && p.version === pkg.version);
                if (!exists) {
                    projects.push({
                        name: pkg.projectName,
                        version: pkg.version
                    });
                }
            }
        });

        return ensureArray(searchResults).map(searchPkg => {
            const key = searchPkg.id.toLowerCase();
            const installedPkg = installedMap.get(key);
            const projects = projectsMap.get(key);

            if (installedPkg && projects && projects.length > 0) {
                // Merge installation info into search result
                return {
                    ...searchPkg,
                    projects: projects
                };
            }
            return searchPkg;
        });
    };

    // Helper function to get version options for dropdown
    const getVersionOptions = (pkg: LocalNuGetPackage) => {
        if (!pkg.allVersions || pkg.allVersions.length === 0) {
            return [{ label: pkg.version, value: pkg.version }];
        }

        // Sort versions in descending order (newest first)
        return pkg.allVersions
            .slice()
            .reverse()
            .map(version => ({
                label: version,
                value: version
            }));
    };

    // Helper function to handle dropdown version selection
    const handleVersionChange = (value: string | any) => {
        if (typeof value === 'string') {
            setSelectedVersion(value);
        } else if (value && typeof value.value === 'string') {
            setSelectedVersion(value.value);
        }
    };

    // Fetch detailed package metadata when package is selected
    const selectPackageWithDetails = async (pkg: LocalNuGetPackage, index: number) => {
        setSelectedPackage(pkg);
        setSelectedIndex(index);

        // Check if we already have detailed data
        if (pkg.allVersions && pkg.tags && pkg.projectUrl) {
            log.info('Package already has detailed metadata:', pkg.id);
            return;
        }

        // Fetch detailed metadata
        log.info('Fetching detailed metadata for package:', pkg.id);
        try {
            vscode.postMessage({
                type: 'getPackageDetails',
                payload: { packageId: pkg.id }
            });
        } catch (error) {
            log.error('Error fetching package details:', error);
        }
    };

    const handleBulkUpdate = () => {
        const selectedPackages = ensureArray(data.updatesAvailable).filter(pkg => pkg.selected);
        if (selectedPackages.length > 0) {
            vscode.postMessage({ type: 'bulkUpdatePackages', payload: { packages: selectedPackages } });
        }
    };

    // Cache enhanced search results to avoid multiple processing
    const enhancedSearchResults = React.useMemo(() => {
        return enhanceWithInstalledInfo(data.searchResults, data.installedPackages);
    }, [data.searchResults, data.installedPackages]);

    // Keyboard navigation helpers
    const getCurrentPackageList = () => {
        switch (activeTab) {
            case 'browse':
                return filterPackages(enhancedSearchResults, searchTerm);
            case 'installed':
                return filterPackages(ensureArray(data.installedPackages), filterTerm);
            case 'updates':
                return filterPackages(ensureArray(data.updatesAvailable), filterTerm);
            case 'consolidate':
                return filterPackages(ensureArray(data.consolidatePackages || []), filterTerm);
            default:
                return [];
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        const packages = getCurrentPackageList();
        if (packages.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const newIndex = selectedIndex < packages.length - 1 ? selectedIndex + 1 : 0;
            selectPackageWithDetails(packages[newIndex], newIndex);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const newIndex = selectedIndex > 0 ? selectedIndex - 1 : packages.length - 1;
            selectPackageWithDetails(packages[newIndex], newIndex);
        }
    };

    // Reset selection when tab changes or package list changes
    React.useEffect(() => {
        setSelectedIndex(-1);
        setSelectedPackage(null);
    }, [activeTab, data.searchResults, data.installedPackages, data.updatesAvailable, searchTerm, filterTerm]);

    // Scroll selected item into view
    React.useEffect(() => {
        if (selectedItemRef.current) {
            selectedItemRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }, [selectedIndex]);

    const browseView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Search Input */}
            <div style={{
                paddingBottom: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <TextField
                        placeholder="Search for packages..."
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleSearch();
                            }
                        }}
                        style={{ flex: 1 }}
                    />
                    <Button
                        onClick={handleSearch}
                        disabled={loading}
                        appearance="primary"
                    >
                        <Icon name="search" />
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
                <div
                    style={{
                        width: '40%',
                        borderRight: '1px solid var(--vscode-panel-border)',
                        overflow: 'auto',
                        overscrollBehavior: 'contain',
                        maxHeight: '100%'
                    }}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                >
                    <PackageList
                        packages={enhancedSearchResults}
                        loading={loading}
                        emptyMessage="Search for packages to browse"
                        loadingMessage="Searching for packages..."
                        searchTerm={searchTerm}
                        hasSearched={hasSearched}
                        selectedIndex={selectedIndex}
                        selectedPackage={selectedPackage}
                        selectedItemRef={selectedItemRef}
                        onPackageSelect={selectPackageWithDetails}
                        getPackageIconUrl={getPackageIconUrl}
                        title="Browse"
                    />
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                    {selectedPackage ? (
                        <div>
                            <NugetHeader selectedPackage={selectedPackage} />
                            <ProjectList
                                selectedPackage={selectedPackage}
                                projects={data.projects || []}
                                installedPackages={enhancedSearchResults || []}
                                selectedProjects={selectedProjects}
                                setSelectedProjects={setSelectedProjects}
                                 />
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
                                        <Dropdown
                                            value={selectedVersion || selectedPackage.version}
                                            onChange={handleVersionChange}
                                            options={getVersionOptions(selectedPackage)}
                                            style={{ flex: 1, maxWidth: '200px' }}
                                        />
                                    </div>
                                    <Button
                                        appearance="primary"
                                        disabled={selectedProjects.size === 0}
                                        onClick={() => {
                                            log.info('Install action from Browse:', {
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
                                        fontSize: '12px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        marginTop: '12px',
                                        fontStyle: 'italic'
                                    }}>
                                        Select one or more projects to install to
                                    </div>
                                )}
                            </div>

                            <NugetDetails
                                selectedPackage={selectedPackage}
                                packageReadmes={packageReadmes}
                             />
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic'
                        }}>
                            Select a package to view details
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const installedView = (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
            {/* Search and Filter */}
            <div style={{
                paddingBottom: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <TextField
                        value={filterTerm}
                        onChange={setFilterTerm}
                        placeholder="Filter installed packages..."
                        style={{ flex: 1 }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                <div
                    style={{
                        width: '40%',
                        borderRight: '1px solid var(--vscode-panel-border)',
                        overflow: 'auto',
                        overscrollBehavior: 'contain',
                        maxHeight: '100%'
                    }}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                >
                    <PackageList
                        packages={filteredPackages}
                        loading={loading}
                        emptyMessage="No packages installed"
                        loadingMessage="Loading installed packages..."
                        selectedIndex={selectedIndex}
                        selectedPackage={selectedPackage}
                        selectedItemRef={selectedItemRef}
                        onPackageSelect={selectPackageWithDetails}
                        getPackageIconUrl={getPackageIconUrl}
                        title="Installed"
                    />
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                {selectedPackage ? (
                    <div>
                        <NugetHeader selectedPackage={selectedPackage} />
                        <ProjectList
                                selectedPackage={selectedPackage}
                                projects={data.projects || []}
                                selectedProjects={selectedProjects}
                                setSelectedProjects={setSelectedProjects}
                                 />
                        {/* Version Selection and Actions */}
                        <div style={{
                            background: 'var(--vscode-panel-background)',
                            border: '1px solid var(--vscode-panel-border)',
                            borderRadius: '4px',
                            padding: '8px 16px',
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
                                    <Dropdown
                                        value={selectedVersion || selectedPackage.version}
                                        onChange={handleVersionChange}
                                        options={getVersionOptions(selectedPackage)}
                                        style={{ flex: 1, maxWidth: '200px' }}
                                    />
                                </div>
                                <Button
                                    appearance="primary"
                                    disabled={selectedProjects.size === 0}
                                    onClick={() => {
                                        log.info('Install/Update action:', {
                                            package: selectedPackage.id,
                                            version: selectedVersion || selectedPackage.version,
                                            projects: Array.from(selectedProjects)
                                        });
                                    }}
                                >
                                    Install/Update
                                </Button>
                            </div>

                            {/* Uninstall Section */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600
                                }}>
                                    Remove package from selected projects
                                </div>
                                <Button
                                    appearance="secondary"
                                    disabled={selectedProjects.size === 0}
                                    onClick={() => {
                                        log.info('Uninstall action:', {
                                            package: selectedPackage.id,
                                            projects: Array.from(selectedProjects)
                                        });
                                        handleUninstallPackage(selectedPackage);
                                    }}
                                >
                                    Uninstall
                                </Button>
                            </div>

                            {selectedProjects.size === 0 && (
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginTop: '12px',
                                    fontStyle: 'italic'
                                }}>
                                    Select one or more projects to perform actions
                                </div>
                            )}
                        </div>
                        <NugetDetails
                                selectedPackage={selectedPackage}
                                packageReadmes={packageReadmes}
                             />
                    </div>
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic'
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
            {/* Search and Filter */}
            <div style={{
                paddingBottom: '12px',
                borderBottom: '1px solid var(--vscode-panel-border)',
                background: 'var(--vscode-editor-background)'
            }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <TextField
                        value={filterTerm}
                        onChange={setFilterTerm}
                        placeholder="Filter packages with updates..."
                        style={{ flex: 1 }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                <div
                    style={{
                        width: '40%',
                        borderRight: '1px solid var(--vscode-panel-border)',
                        overflow: 'auto',
                        overscrollBehavior: 'contain',
                        maxHeight: '100%'
                    }}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                >
                    <PackageList
                        packages={filteredUpdates}
                        loading={loading}
                        emptyMessage="No updates available"
                        loadingMessage="Checking for updates..."
                        selectedIndex={selectedIndex}
                        selectedPackage={selectedPackage}
                        selectedItemRef={selectedItemRef}
                        onPackageSelect={selectPackageWithDetails}
                        getPackageIconUrl={getPackageIconUrl}
                        showUpdateInfo={true}
                        getVersionChangeText={getVersionChangeText}
                        title="Updates"
                    />
                </div>

                {/* Right Panel - Package Details */}
                <div style={{
                    flex: 1,
                    padding: '16px',
                    overflow: 'auto'
                }}>
                    {selectedPackage ? (
                        <div>
                            <NugetHeader selectedPackage={selectedPackage} />
                            <ProjectList
                                selectedPackage={selectedPackage}
                                projects={data.projects || []}
                                installedPackages={data.installedPackages || []}
                                selectedProjects={selectedProjects}
                                setSelectedProjects={setSelectedProjects}
                                 />
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
                                        <Dropdown
                                            value={selectedVersion || selectedPackage.latestVersion}
                                            onChange={handleVersionChange}
                                            options={getVersionOptions(selectedPackage)}
                                            style={{ flex: 1, maxWidth: '200px' }}
                                        />
                                    </div>
                                    <Button
                                        appearance="primary"
                                        disabled={selectedProjects.size === 0}
                                        onClick={() => {
                                            log.info('Update action:', {
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
                                        fontSize: '12px',
                                        color: 'var(--vscode-descriptionForeground)',
                                        marginTop: '12px',
                                        fontStyle: 'italic'
                                    }}>
                                        Select one or more projects to update
                                    </div>
                                )}
                            </div>

                            <NugetDetails
                                selectedPackage={selectedPackage}
                                packageReadmes={packageReadmes}
                             />
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic'
                        }}>
                            Select a package to view details
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const tabs = [
        { id: 'browse', label: 'Browse' },
        { id: 'installed', label: 'Installed' },
        { id: 'updates', label: 'Updates' },
        { id: 'consolidate', label: 'Consolidate' }
    ];

    const rightSidePanel = (
        <div style={{
            flex: 1,
            padding: '16px',
            overflow: 'auto'
        }}>
            {selectedPackage ? (
                <div>
                    <NugetHeader selectedPackage={selectedPackage} />
                    <ProjectList
                        selectedPackage={selectedPackage}
                        projects={data.projects || []}
                        selectedProjects={selectedProjects}
                        setSelectedProjects={setSelectedProjects}
                         />
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
                            marginBottom: '12px'
                        }}>
                            <span style={{
                                fontSize: '14px',
                                fontWeight: 500,
                                color: 'var(--vscode-foreground)'
                            }}>
                                Version
                            </span>
                            <Dropdown
                                value={selectedVersion || selectedPackage.version}
                                options={getVersionOptions(selectedPackage)}
                                onChange={handleVersionChange}
                                placeholder="Select version"
                            />
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <span style={{
                                fontSize: '14px',
                                fontWeight: 500,
                                color: 'var(--vscode-foreground)'
                            }}>
                                Install
                            </span>
                            <Button
                                appearance="primary"
                                disabled={selectedProjects.size === 0}
                                onClick={() => {
                                    log.info('Install button clicked for:', {
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
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                marginTop: '12px',
                                fontStyle: 'italic'
                            }}>
                                Select one or more projects to install to
                            </div>
                        )}
                    </div>

                    <NugetDetails
                        selectedPackage={selectedPackage}
                        packageReadmes={packageReadmes}
                     />
                </div>
            ) : (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'var(--vscode-descriptionForeground)',
                    fontStyle: 'italic'
                }}>
                    Select a package to view details
                </div>
            )}
        </div>
    );

    const consolidateView = (
        <div style={{ display: 'flex', flex: 1, height: '100%' }}>
            <div style={{ flex: 1, borderRight: '1px solid var(--vscode-panel-border)' }}>
                <PackageList
                    packages={ensureArray(data.consolidatePackages || [])}
                    loading={false}
                    emptyMessage="No packages need consolidation"
                    selectedIndex={selectedIndex}
                    selectedPackage={selectedPackage}
                    selectedItemRef={selectedItemRef}
                    onPackageSelect={selectPackageWithDetails}
                    getPackageIconUrl={getPackageIconUrl}
                    title="Consolidate"
                />
            </div>
            {rightSidePanel}
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
            <style>{`
                .nuget-panels [role="tab"][aria-selected="true"] {
                    border-bottom: 2px solid var(--vscode-focusBorder) !important;
                }
                .nuget-panels [role="tab"] {
                    border-bottom: 2px solid transparent;
                }
                .nuget-panels .tabs button[aria-selected="true"] {
                    border-bottom: 2px solid var(--vscode-focusBorder) !important;
                }
                .nuget-panels .tabs button {
                    border-bottom: 2px solid transparent;
                }
            `}</style>
            <LoadingBar visible={shouldShowLoadingBar} />
            <Panels
                className="nuget-panels"
                tabs={tabs}
                views={views}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
};
