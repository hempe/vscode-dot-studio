import React, { useEffect, useState, useRef } from 'react';
import { Panels, TextField, Button, Checkbox, Icon } from 'vscrui';
import { logger } from '../shared/logger';
import { LoadingBar } from '../shared/LoadingBar';
import { ensureArray, formatAuthors, LocalNuGetPackage, sendToBackend } from './shared';
import NugetDetails from './components/NugetDetails';
import NugetHeader from './components/NugetHeader';
import { PackageActions } from './components/PackageActions';
import ProjectList from './components/ProjectList';
import { PackageList } from './components/PackageList';
import { ProjectInfo } from '../../services/nuget/types';
import { VersionUtils } from '../../services/versionUtils';
import { NuGetViewData, UICmd } from '../../types/uiCmd';

const log = logger('NuGetReact');





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
    const [consolidateLoading, setConsolidateLoading] = useState(false);
    const [consolidateLoaded, setConsolidateLoaded] = useState(false);
    const [selectedPackage, setSelectedPackage] = useState<LocalNuGetPackage | null>(null);
    const selectedPackageRef = useRef<LocalNuGetPackage | null>(null);

    // Keep ref in sync with state
    useEffect(() => {
        selectedPackageRef.current = selectedPackage;
    }, [selectedPackage]);
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

    // Helper function to determine if a version is prerelease using semver
    const includePrereleaseFn = (includePrerelease: boolean): (versions: string) => boolean => VersionUtils.includePrerelease(includePrerelease);
    const compare = (a: string, b: string): number => VersionUtils.compare(a, b);
    const isPrerelease = (version: string): boolean => VersionUtils.isPrerelease(version);

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
        return formatVersionDisplay(
            pkg.currentVersion,
            pkg.versions?.filter(includePrereleaseFn(includePrerelease))
                .sort(compare)[0]);
    };

    // Compute filtered package lists
    const filteredPackages = filterPackages(ensureArray(data.installedPackages), filterTerm);
    const filteredUpdates = filterPackages(ensureArray(data.updatesAvailable), filterTerm);

    useEffect(() => {
        sendToBackend({ type: 'getNuGetData' });

        const handleMessage = (event: MessageEvent) => {
            const message = event.data as UICmd;
            log.info('NuGet React: Received message:', message);

            switch (message.type) {
                case 'nugetData':
                    log.info('NuGet React: Setting data to:', message.payload);
                    // Backend now sends properly grouped data
                    const safeData = message.payload;

                    log.debug('NuGet React: Processed installed packages:', safeData.installedPackages);
                    log.debug('NuGet React: Processed consolidate packages:', safeData.consolidatePackages);

                    setData(safeData);

                    // Try to preserve selected package after data refresh, or auto-select first package
                    if (selectedPackageRef.current) {
                        // Find the same package in updated data to preserve selection (check all arrays)
                        // For Browse tab, we need to check the enhanced search results too
                        const freshEnhancedResults = enhanceWithInstalledInfo(safeData.searchResults, safeData.installedPackages);

                        log.info('NuGet React: Looking for package in refresh data:', {
                            selectedPackageId: selectedPackageRef.current.id,
                            installedPackagesCount: safeData.installedPackages?.length ?? 0,
                            installedPackageIds: safeData.installedPackages?.map(p => p.id) ?? []
                        });

                        const updatedPackage =
                            safeData.installedPackages?.find(pkg => pkg.id === selectedPackageRef.current!.id) ||
                            freshEnhancedResults?.find(pkg => pkg.id === selectedPackageRef.current!.id) ||
                            safeData.updatesAvailable?.find(pkg => pkg.id === selectedPackageRef.current!.id);

                        if (updatedPackage) {
                            log.info('NuGet React: Preserving selection after data refresh:', {
                                packageId: updatedPackage.id,
                                oldVersion: selectedPackageRef.current.currentVersion,
                                newVersion: updatedPackage.currentVersion
                            });
                            setSelectedPackage(updatedPackage);
                        } else {
                            // Keep the existing selection even if not found in fresh data
                            // This handles cases where data refresh timing might cause temporary mismatches
                            log.warn('NuGet React: Package not found in fresh data, keeping existing selection:', {
                                selectedPackageId: selectedPackageRef.current.id,
                                availablePackages: safeData.installedPackages?.map(p => ({ id: p.id, version: p.version }))
                            });
                        }
                    } else if (safeData.installedPackages && safeData.installedPackages.length > 0) {
                        // Auto-select first installed package when data loads initially
                        log.info('NuGet React: Auto-selecting package:', safeData.installedPackages[0]);
                        setSelectedPackage(safeData.installedPackages[0]);
                    }

                    // Mark initialization as complete
                    setInitializing(false);
                    break;
                case 'searchResults':
                    const searchResults = message.payload?.searchResults;
                    log.info('NuGet React: Setting searchResults to:', searchResults);
                    setData(prev => ({ ...prev, searchResults: ensureArray(searchResults) }));
                    setLoading(false);
                    setHasSearched(true);
                    break;
                case 'packageIcon':
                    if (message.payload.packageId && message.payload.version) {
                        const iconKey = `${message.payload.packageId}@${message.payload.version}`;
                        const packageKey = message.payload.packageId.toLowerCase(); // Use only package ID for caching

                        if (message.payload.iconUri) {
                            setPackageIcons(prev => {
                                const newMap = new Map(prev);
                                newMap.set(packageKey, message.payload.iconUri!);
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
                    if (message.payload.packageId && message.payload.version) {
                        const readmeKey = `${message.payload.packageId}@${message.payload.version}`;
                        const packageKey = message.payload.packageId.toLowerCase();

                        if (message.payload.readmeUrl) {
                            setPackageReadmes(prev => {
                                const newMap = new Map(prev);
                                newMap.set(packageKey, message.payload.readmeUrl!);
                                return newMap;
                            });
                            log.info(`README URL received for ${readmeKey}: ${message.payload.readmeUrl}`);
                        } else {
                            log.info(`README not available for ${readmeKey}`);
                        }
                    }
                    break;
                case 'installComplete':
                case 'uninstallComplete':
                    // Clear loading state when install/uninstall operations complete
                    setLoading(false);
                    log.info(`NuGet React: ${message.type} - success: ${message.payload.success}`);

                    // Refresh data to reflect the changes in the UI
                    if (message.payload.success) {
                        log.info(`NuGet React: Refreshing data after successful ${message.type}`);
                        sendToBackend({ type: 'getNuGetData' });
                    }
                    break;
                case 'bulkUpdateComplete':
                    // Handle bulk update completion
                    setLoading(false);
                    log.info(`NuGet React: Bulk update complete - success: ${message.payload.success}`);

                    // Refresh data and clear selections after successful bulk update
                    if (message.payload.success) {
                        log.info(`NuGet React: Refreshing data after successful bulk update`);
                        sendToBackend({ type: 'getNuGetData' });
                        // Clear all selections after successful update
                        setData(prevData => ({
                            ...prevData,
                            updatesAvailable: prevData.updatesAvailable?.map(p => ({ ...p, selected: false })) ?? []
                        }));
                    }
                    break;

                case 'bulkConsolidateComplete':
                    // Handle bulk consolidate completion
                    setLoading(false);
                    log.info(`NuGet React: Bulk consolidate complete - success: ${message.payload.success}`);

                    // Refresh data and clear selections after successful bulk consolidate
                    if (message.payload.success) {
                        log.info(`NuGet React: Refreshing data after successful bulk consolidate`);
                        // Reset consolidate loaded state to trigger a fresh reload
                        setConsolidateLoaded(false);
                        // Clear all selections after successful consolidation
                        setData(prevData => ({
                            ...prevData,
                            consolidatePackages: prevData.consolidatePackages?.map(p => ({ ...p, selected: false })) || []
                        }));
                    }
                    break;
                case 'consolidatePackages':
                    log.info('NuGet React: Received consolidate packages:', message.payload.consolidatePackages);
                    setData(prev => ({ ...prev, consolidatePackages: ensureArray(message.payload.consolidatePackages) }));
                    setConsolidateLoading(false);
                    setConsolidateLoaded(true);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Handle filter changes - reset selection if current package is not visible
    useEffect(() => {
        if (selectedPackage && filterTerm) {
            const filteredPackages = filterPackages(ensureArray(data.installedPackages), filterTerm);

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
            log.info('Frontend: Starting search for:', searchTerm);
            setLoading(true);
            sendToBackend({
                type: 'searchPackages',
                payload: {
                    query: searchTerm,
                }
            });
            log.info('Frontend: Search message sent to backend');
        }
    };

    const handleInstallPackage = (pkg: LocalNuGetPackage, projects: string[], version: string) => {
        setLoading(true);
        sendToBackend({
            type: 'installPackage',
            payload: {
                package: pkg,
                projects: projects,
                version: version
            }
        });
    };

    const handleUninstallPackage = (pkg: LocalNuGetPackage, projects: string[]) => {
        setLoading(true);
        sendToBackend({
            type: 'uninstallPackage',
            payload: {
                package: pkg,
                projects: projects
            }
        });
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

        sendToBackend({
            type: 'getPackageIcon',
            payload: {
                packageId: pkg.id,
                version: pkg.currentVersion
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

        sendToBackend({
            type: 'getPackageReadme',
            payload: {
                packageId: pkg.id,
                version: pkg.currentVersion
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
    const enhanceWithInstalledInfo = (searchResults?: LocalNuGetPackage[] | null, installedPackages?: LocalNuGetPackage[] | null): LocalNuGetPackage[] => {
        // Group installed packages by ID and extract their projects array
        const installedMap = new Map<string, LocalNuGetPackage>();
        const projectsMap = new Map<string, ProjectInfo[]>();

        ensureArray(installedPackages).forEach(pkg => {
            const key = pkg.id.toLowerCase();

            // Store the package info
            if (!installedMap.has(key)) {
                installedMap.set(key, pkg);
            }

            // Use the projects array from the backend (already contains full ProjectInfo)
            if (pkg.projects && pkg.projects.length > 0) {
                projectsMap.set(key, pkg.projects);
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
        if (!pkg.versions || pkg.versions.length === 0) {
            return [{ label: pkg.currentVersion, value: pkg.currentVersion }];
        }

        // Filter versions based on prerelease setting
        let filteredVersions = pkg.versions;
        if (!includePrerelease) {
            filteredVersions = pkg.versions.filter(version => !isPrerelease(version));
        }

        // Sort versions in descending order (newest first) using semver
        return filteredVersions
            .slice()
            .sort((a, b) => compare(a, b)) // rcompare for descending order
            .map(version => ({
                label: version,
                value: version
            }));
    };

    // Helper function to handle dropdown version selection
    const handleVersionChange = (value: string | unknown) => {
        if (typeof value === 'string') {
            setSelectedVersion(value);
        } else if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
            setSelectedVersion(value.value);
        }
    };

    // Fetch detailed package metadata when package is selected
    const selectPackageWithDetails = async (pkg: LocalNuGetPackage, index: number) => {
        setSelectedPackage(pkg);
        setSelectedIndex(index);
        return;
    };

    const handlePackageToggle = (pkg: LocalNuGetPackage, checked: boolean) => {
        setData(prevData => ({
            ...prevData,
            updatesAvailable: prevData.updatesAvailable?.map(p =>
                p.id === pkg.id ? { ...p, selected: checked } : p
            ) ?? []
        }));
    };

    const handleConsolidatePackageToggle = (pkg: LocalNuGetPackage, checked: boolean) => {
        setData(prevData => ({
            ...prevData,
            consolidatePackages: prevData.consolidatePackages?.map(p =>
                p.id === pkg.id ? { ...p, selected: checked } : p
            ) || []
        }));
    };

    const handleSelectAllUpdates = (checked: boolean) => {
        // Only select/deselect the filtered packages
        const filteredPackageIds = new Set(filteredUpdates.map(pkg => pkg.id));

        setData(prevData => ({
            ...prevData,
            updatesAvailable: prevData.updatesAvailable?.map(p =>
                filteredPackageIds.has(p.id) ? { ...p, selected: checked } : p
            ) ?? []
        }));
    };

    // Helper to get select all state for filtered packages only
    const getSelectAllState = () => {
        if (filteredUpdates.length === 0) return false;
        const selectedCount = filteredUpdates.filter(pkg => pkg.selected).length;
        return selectedCount === filteredUpdates.length;
    };

    const handleBulkUpdate = () => {
        const selectedPackages = ensureArray(data.updatesAvailable).filter(pkg => pkg.selected);
        if (selectedPackages.length > 0) {
            setLoading(true);
            sendToBackend({
                type: 'bulkUpdatePackages',
                payload: {
                    packages: selectedPackages,
                    includePrerelease
                }
            });
        }
    };

    // Consolidate package selection management
    const filteredConsolidate = filterPackages(ensureArray(data.consolidatePackages || []), filterTerm);

    const handleSelectAllConsolidate = (checked: boolean) => {
        // Only select/deselect the filtered packages
        const filteredPackageIds = new Set(filteredConsolidate.map(pkg => pkg.id));

        setData(prevData => ({
            ...prevData,
            consolidatePackages: prevData.consolidatePackages?.map(p =>
                filteredPackageIds.has(p.id) ? { ...p, selected: checked } : p
            ) || []
        }));
    };

    // Helper to get select all state for filtered consolidate packages
    const getSelectAllConsolidateState = () => {
        if (filteredConsolidate.length === 0) return false;
        const selectedCount = filteredConsolidate.filter(pkg => pkg.selected).length;
        return selectedCount === filteredConsolidate.length;
    };

    const handleBulkConsolidate = () => {
        const selectedPackages = ensureArray(data.consolidatePackages).filter(pkg => pkg.selected);
        if (selectedPackages.length > 0) {
            setLoading(true);
            sendToBackend({
                type: 'bulkConsolidatePackages',
                payload: {
                    packages: selectedPackages,
                    includePrerelease
                }
            });
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

    // Reset selection when tab changes or search terms change
    React.useEffect(() => {
        setSelectedIndex(-1);
        setSelectedPackage(null);
    }, [activeTab, searchTerm, filterTerm]);

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
                        placeholder={initializing ? "Initializing..." : "Search for packages..."}
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !initializing) {
                                handleSearch();
                            }
                        }}
                        disabled={initializing}
                        style={{ flex: 1 }}
                    />
                    <Button
                        onClick={handleSearch}
                        disabled={loading || initializing}
                        appearance="primary"
                    >
                        <Icon name="search" />
                    </Button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Checkbox
                        checked={includePrerelease}
                        onChange={setIncludePrerelease}
                        disabled={initializing}
                    />
                    <label style={{
                        fontSize: '13px',
                        color: 'var(--vscode-foreground)',
                        cursor: initializing ? 'default' : 'pointer'
                    }} onClick={() => !initializing && setIncludePrerelease(!includePrerelease)}>
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
                        includePrerelease={includePrerelease}
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
                                selectedProjects={selectedProjects}
                                setSelectedProjects={setSelectedProjects}
                                initializing={initializing}
                                projectPath={data.projectPath}
                            />
                            <PackageActions
                                selectedPackage={selectedPackage}
                                selectedVersion={selectedVersion}
                                selectedProjects={selectedProjects}
                                initializing={initializing}
                                loading={loading}
                                totalProjects={data.projects?.length || 0}
                                onVersionChange={handleVersionChange}
                                onInstallUpdate={handleInstallPackage}
                                onUninstall={handleUninstallPackage}
                                getVersionOptions={getVersionOptions}
                                installButtonText="Install"
                            />

                            {selectedProjects.size === 0 && (
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '16px',
                                    fontStyle: 'italic'
                                }}>
                                    Select one or more projects to install to
                                </div>
                            )}

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
                        placeholder={initializing ? "Initializing..." : "Filter installed packages..."}
                        disabled={initializing}
                        style={{ flex: 1 }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Checkbox
                        checked={includePrerelease}
                        onChange={setIncludePrerelease}
                        disabled={initializing}
                    />
                    <label style={{
                        fontSize: '13px',
                        color: 'var(--vscode-foreground)',
                        cursor: initializing ? 'default' : 'pointer'
                    }} onClick={() => !initializing && setIncludePrerelease(!includePrerelease)}>
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
                        includePrerelease={includePrerelease}
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
                                initializing={initializing}
                            />
                            <PackageActions
                                selectedPackage={selectedPackage}
                                selectedVersion={selectedVersion}
                                selectedProjects={selectedProjects}
                                initializing={initializing}
                                loading={loading}
                                totalProjects={data.projects?.length || 0}
                                onVersionChange={handleVersionChange}
                                onInstallUpdate={handleInstallPackage}
                                onUninstall={handleUninstallPackage}
                                getVersionOptions={getVersionOptions}
                            />
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
                        placeholder={initializing ? "Initializing..." : "Filter packages with updates..."}
                        disabled={initializing}
                        style={{ flex: 1 }}
                    />
                    <Button
                        onClick={handleBulkUpdate}
                        disabled={
                            initializing ||
                            loading ||
                            !ensureArray(data.updatesAvailable).some(pkg => pkg.selected)
                        }
                        appearance="primary"
                    >
                        Update Selected
                    </Button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Checkbox
                            checked={includePrerelease}
                            onChange={setIncludePrerelease}
                            disabled={initializing}
                        />
                        <label style={{
                            fontSize: '13px',
                            color: 'var(--vscode-foreground)',
                            cursor: initializing ? 'default' : 'pointer'
                        }} onClick={() => !initializing && setIncludePrerelease(!includePrerelease)}>
                            Include prerelease
                        </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Checkbox
                            checked={getSelectAllState()}
                            onChange={handleSelectAllUpdates}
                            disabled={initializing || filteredUpdates.length === 0}
                        />
                        <label style={{
                            fontSize: '13px',
                            color: 'var(--vscode-foreground)',
                            cursor: (initializing || filteredUpdates.length === 0) ? 'default' : 'pointer'
                        }} onClick={() => !initializing && filteredUpdates.length > 0 && handleSelectAllUpdates(!getSelectAllState())}>
                            Select all
                        </label>
                    </div>
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
                        includePrerelease={includePrerelease}
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
                        showCheckboxes={true}
                        onPackageToggle={handlePackageToggle}
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
                                initializing={initializing}
                                projectPath={data.projectPath}
                            />
                            <PackageActions
                                selectedPackage={selectedPackage}
                                selectedVersion={selectedVersion}
                                selectedProjects={selectedProjects}
                                initializing={initializing}
                                loading={loading}
                                totalProjects={data.projects?.length || 0}
                                onVersionChange={handleVersionChange}
                                onInstallUpdate={handleInstallPackage}
                                onUninstall={handleUninstallPackage}
                                getVersionOptions={getVersionOptions}
                                installButtonText="Install"
                            />

                            {selectedProjects.size === 0 && (
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '16px',
                                    fontStyle: 'italic'
                                }}>
                                    Select one or more projects to install to
                                </div>
                            )}

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

    // Only show consolidate tab if there are multiple projects
    const shouldShowConsolidate = (data.projects?.length || 0) > 1;

    const tabs = [
        { id: 'browse', label: 'Browse' },
        { id: 'installed', label: 'Installed' },
        { id: 'updates', label: 'Updates' },
        ...(shouldShowConsolidate ? [{ id: 'consolidate', label: 'Consolidate' }] : [])
    ];

    // Switch to installed tab if currently on consolidate but it's hidden
    React.useEffect(() => {
        if (activeTab === 'consolidate' && !shouldShowConsolidate) {
            setActiveTab('installed');
        }
    }, [activeTab, shouldShowConsolidate]);

    // Load consolidate data when consolidate tab is accessed
    React.useEffect(() => {
        if (activeTab === 'consolidate' && shouldShowConsolidate && !consolidateLoaded && !consolidateLoading) {
            setConsolidateLoading(true);
            sendToBackend({ type: 'getConsolidatePackages' });
        }
    }, [activeTab, shouldShowConsolidate, consolidateLoaded, consolidateLoading]);

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
                        initializing={initializing}
                        projectPath={data.projectPath}
                    />
                    <PackageActions
                        selectedPackage={selectedPackage}
                        selectedVersion={selectedVersion}
                        selectedProjects={selectedProjects}
                        initializing={initializing}
                        loading={loading}
                        onVersionChange={handleVersionChange}
                        onInstallUpdate={handleInstallPackage}
                        onUninstall={handleUninstallPackage}
                        getVersionOptions={getVersionOptions}
                        installButtonText="Install"
                    />

                    {selectedProjects.size === 0 && (
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            marginBottom: '16px',
                            fontStyle: 'italic'
                        }}>
                            Select one or more projects to install to
                        </div>
                    )}

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
                        placeholder={initializing ? "Initializing..." : "Filter packages to consolidate..."}
                        disabled={initializing}
                        style={{ flex: 1 }}
                    />
                    <Button
                        onClick={handleBulkConsolidate}
                        disabled={
                            initializing ||
                            loading ||
                            consolidateLoading ||
                            !ensureArray(data.consolidatePackages).some(pkg => pkg.selected)
                        }
                        appearance="primary"
                    >
                        Consolidate
                    </Button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Checkbox
                            checked={getSelectAllConsolidateState()}
                            onChange={handleSelectAllConsolidate}
                            disabled={initializing || consolidateLoading || filteredConsolidate.length === 0}
                        />
                        <label style={{
                            fontSize: '13px',
                            color: 'var(--vscode-foreground)',
                            cursor: (initializing || consolidateLoading || filteredConsolidate.length === 0) ? 'default' : 'pointer'
                        }} onClick={() => !initializing && !consolidateLoading && filteredConsolidate.length > 0 && handleSelectAllConsolidate(!getSelectAllConsolidateState())}>
                            Select all
                        </label>
                    </div>
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
                >
                    <PackageList
                        includePrerelease={includePrerelease}
                        packages={filteredConsolidate}
                        loading={consolidateLoading}
                        emptyMessage={consolidateLoaded ? "No packages need consolidation" : "Loading consolidation data..."}
                        loadingMessage="Loading consolidation data..."
                        selectedIndex={selectedIndex}
                        selectedPackage={selectedPackage}
                        selectedItemRef={selectedItemRef}
                        onPackageSelect={selectPackageWithDetails}
                        getPackageIconUrl={getPackageIconUrl}
                        showCheckboxes={true}
                        onPackageToggle={handleConsolidatePackageToggle}
                        title="Consolidate"
                    />
                </div>

                {/* Right Panel - Package Details */}
                <div style={{ width: '60%', overflow: 'auto' }}>
                    {rightSidePanel}
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

    const shouldShowLoadingBar = loading || initializing || consolidateLoading;

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
