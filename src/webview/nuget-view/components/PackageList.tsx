import React from 'react';
import { LoadingMessage } from '../../shared/LoadingBar';
import { LocalNuGetPackage, ensureArray, formatAuthors } from '../shared';
import { Checkbox } from 'vscrui';
import { VersionUtils } from '../../../services/versionUtils';



interface PackageListProps {
    packages: LocalNuGetPackage[];
    loading?: boolean;
    includePrerelease: boolean;
    emptyMessage: string;
    loadingMessage?: string;
    searchTerm?: string;
    hasSearched?: boolean;
    selectedIndex: number;
    selectedPackage: LocalNuGetPackage | null;
    selectedItemRef: React.RefObject<HTMLDivElement>;
    onPackageSelect: (pkg: LocalNuGetPackage, index: number) => void;
    getPackageIconUrl: (pkg: LocalNuGetPackage) => string;
    showUpdateInfo?: boolean; // For Updates tab to show version changes
    getVersionChangeText?: (pkg: LocalNuGetPackage) => string;
    title: string;
    showCheckboxes?: boolean; // For Updates tab to show checkboxes
    onPackageToggle?: (pkg: LocalNuGetPackage, checked: boolean) => void;
}

export const PackageList: React.FC<PackageListProps> = ({
    packages,
    loading = false,
    includePrerelease = false,
    emptyMessage,
    loadingMessage = "Loading packages...",
    searchTerm = '',
    hasSearched = false,
    selectedIndex,
    selectedPackage,
    selectedItemRef,
    onPackageSelect,
    getPackageIconUrl,
    showUpdateInfo = false,
    showCheckboxes = false,
    onPackageToggle,
    getVersionChangeText,
    title
}) => {
    const uniquePackages = ensureArray(packages);
    // Helper function to determine if a version is prerelease using semver
    const includePrereleaseFn = (includePrerelease: boolean): (versions: string) => boolean => VersionUtils.includePrerelease(includePrerelease);
    const compare = (a: string, b: string): number => VersionUtils.compare(a, b);

    return (
        <>
            <div style={{
                padding: '8px 12px',
                background: 'var(--vscode-panel-background)',
                borderBottom: '1px solid var(--vscode-panel-border)',
                fontSize: '12px',
                fontWeight: 600
            }}>
                {title} ({uniquePackages.length})
            </div>

            {packages.length === 0 ? (
                <LoadingMessage
                    loading={loading}
                    message={loadingMessage}
                    emptyMessage={emptyMessage}
                    searchTerm={hasSearched ? searchTerm.trim() : ''}
                    hasResults={false}
                />
            ) : (
                uniquePackages.map((pkg, index) => (
                    <div
                        key={`${pkg.id}-${pkg.currentVersion}`}
                        ref={selectedIndex === index ? selectedItemRef : null}
                        style={{
                            padding: '12px',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            cursor: 'pointer',
                            background: selectedIndex === index
                                ? 'var(--vscode-list-activeSelectionBackground)'
                                : selectedPackage?.id === pkg.id
                                    ? 'var(--vscode-list-hoverBackground)'
                                    : 'transparent'
                        }}
                        onClick={() => onPackageSelect(pkg, index)}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            {/* Checkbox for Updates tab */}
                            {showCheckboxes && (
                                <div style={{ paddingTop: '2px' }}>
                                    <Checkbox
                                        checked={pkg.selected || false}
                                        onChange={(checked) => onPackageToggle?.(pkg, checked)}
                                        onClick={(e) => e.stopPropagation()} // Prevent triggering package selection
                                    />
                                </div>
                            )}

                            {/* Package Icon */}
                            <div style={{
                                width: '24px',
                                height: '24px',
                                background: getPackageIconUrl(pkg) ? 'transparent' : 'var(--vscode-button-background)',
                                borderRadius: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                color: 'var(--vscode-button-foreground)',
                                flexShrink: 0,
                                overflow: 'hidden'
                            }}>
                                {(() => {
                                    const iconUrl = getPackageIconUrl(pkg);
                                    return iconUrl ? (
                                        <img
                                            src={iconUrl}
                                            alt={`${pkg.id} icon`}
                                            style={{
                                                width: '20px',
                                                height: '20px',
                                                objectFit: 'contain'
                                            }}
                                            onError={(e) => {
                                                // Fallback to emoji if image fails to load
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                const parent = (e.target as HTMLImageElement).parentElement!;
                                                parent.style.background = 'var(--vscode-button-background)';
                                                parent.innerHTML = '📦';
                                            }}
                                        />
                                    ) : (
                                        '📦'
                                    );
                                })()}
                            </div>

                            {/* Package Details */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'row' }}>
                                {/* Top row: Package name with authors and version */}
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        marginBottom: '2px'
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{
                                                fontWeight: 500,
                                                fontSize: '13px',
                                                color: 'var(--vscode-foreground)'
                                            }}>
                                                {pkg.id}
                                            </span>
                                            {pkg.authors && (
                                                <span style={{
                                                    fontWeight: 'normal',
                                                    fontSize: '12px',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    marginLeft: '8px'
                                                }}>
                                                    by {formatAuthors(pkg.authors)}
                                                </span>
                                            )}
                                        </div>

                                    </div>
                                    {/* Show update info for Updates tab */}
                                    {showUpdateInfo && getVersionChangeText && (
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-charts-blue)',
                                            marginBottom: '4px',
                                            fontWeight: 500
                                        }}>
                                            {getVersionChangeText(pkg)}
                                        </div>
                                    )}

                                    {/* Package description */}
                                    {pkg.description && (
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            lineHeight: '1.3',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden'
                                        }}>
                                            {pkg.description}
                                        </div>
                                    )}
                                </div>
                                {/* Version in top right */}
                                <div style={{
                                    flexShrink: 0,
                                    marginLeft: '8px',
                                    textAlign: 'right'
                                }}>
                                    <div style={{
                                        fontSize: '13px',
                                        fontWeight: 500,
                                        color: 'var(--vscode-foreground)'
                                    }}>
                                        v{pkg.versions?.filter(includePrereleaseFn(includePrerelease))
                                            .sort(compare)[0] || pkg.currentVersion}
                                    </div>
                                    {/* Max installed version - only show if different from current and package has projects */}
                                    {pkg.projects && pkg.projects.length > 0 && (() => {
                                        // Find the highest installed version across all projects
                                        const installedVersions = pkg.projects.map(p => {
                                            const installedPkg = p.packages?.find(installedPkg => installedPkg.id === pkg.id);
                                            return installedPkg?.currentVersion;
                                        }).filter(Boolean);
                                        if (installedVersions.length > 0) {
                                            const maxInstalledVersion = installedVersions.sort((a, b) => {
                                                return compare(a!, b!); // rcompare for descending order
                                            })[0];

                                            // Always show the max installed version when package is installed
                                            return (
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    marginTop: '1px'
                                                }}>
                                                    v{maxInstalledVersion}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </>
    );
};