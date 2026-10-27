import React from 'react';
import { LoadingMessage } from '../../shared/LoadingBar';
import { LocalNuGetPackage, ensureArray, formatAuthors } from '../shared';
import { Checkbox } from 'vscrui';
import { VersionUtils } from '../../../services/versionUtils';
import { isGlobal, versionLabel } from '../versionLabels';
import { advisoryBadges } from '../advisoryView';
import { PackageAdvisory } from '../../../services/nuget/types';



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
    selectedItemRef: React.RefObject<HTMLDivElement | null>;
    onPackageSelect: (pkg: LocalNuGetPackage, index: number) => void;
    getPackageIconUrl: (pkg: LocalNuGetPackage) => string;
    showUpdateInfo?: boolean; // For Updates tab to show version changes
    getVersionChangeText?: (pkg: LocalNuGetPackage) => string;
    title: string;
    showCheckboxes?: boolean; // For Updates tab to show checkboxes
    onPackageToggle?: (pkg: LocalNuGetPackage, checked: boolean) => void;
    /** What is known about the installed version (vulnerabilities, deprecation): shown as labels after the name */
    getAdvisory?: (pkg: LocalNuGetPackage) => PackageAdvisory | undefined;
    /** Small note under the name, e.g. what brings in a transitive package */
    getNote?: (pkg: LocalNuGetPackage) => string | undefined;
    /** Collapsible section: only the title shows while collapsed */
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    /** Position of the first package in the keyboard navigation of the whole tab */
    indexOffset?: number;
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
    title,
    getNote,
    getAdvisory,
    collapsed,
    onToggleCollapsed,
    indexOffset = 0
}) => {
    // Icons that did not load show the package emoji instead (React owns the element, so no innerHTML)
    const [brokenIcons, setBrokenIcons] = React.useState<ReadonlySet<string>>(new Set());
    const uniquePackages = ensureArray(packages);
    // Helper function to determine if a version is prerelease using semver
    const includePrereleaseFn = (includePrerelease: boolean): (versions: string) => boolean => VersionUtils.includePrerelease(includePrerelease);
    const compare = (a: string, b: string): number => VersionUtils.compare(a, b);

    return (
        <>
            <div
                style={{
                    padding: '8px 12px',
                    background: 'var(--vscode-panel-background)',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: onToggleCollapsed ? 'pointer' : undefined,
                    userSelect: onToggleCollapsed ? 'none' : undefined
                }}
                onClick={onToggleCollapsed}
                role={onToggleCollapsed ? 'button' : undefined}
                aria-expanded={onToggleCollapsed ? !collapsed : undefined}
            >
                {onToggleCollapsed && (collapsed ? '▸ ' : '▾ ')}{title} ({uniquePackages.length})
            </div>

            {collapsed ? null : packages.length === 0 ? (
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
                        ref={selectedIndex === index + indexOffset ? selectedItemRef : null}
                        style={{
                            padding: '12px',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            cursor: 'pointer',
                            background: selectedIndex === index + indexOffset
                                ? 'var(--vscode-list-activeSelectionBackground)'
                                : selectedPackage?.id === pkg.id
                                    ? 'var(--vscode-list-hoverBackground)'
                                    : 'transparent'
                        }}
                        onClick={() => onPackageSelect(pkg, index + indexOffset)}
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
                                background: (!brokenIcons.has(pkg.id) && getPackageIconUrl(pkg)) ? 'transparent' : 'var(--vscode-button-background)',
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
                                    const iconUrl = brokenIcons.has(pkg.id) ? '' : getPackageIconUrl(pkg);
                                    return iconUrl ? (
                                        <img
                                            src={iconUrl}
                                            alt={`${pkg.id} icon`}
                                            style={{
                                                width: '20px',
                                                height: '20px',
                                                objectFit: 'contain'
                                            }}
                                            onError={() => setBrokenIcons(prev => new Set(prev).add(pkg.id))}
                                        />
                                    ) : (
                                        '📦'
                                    );
                                })()}
                            </div>

                            {/* Package Details */}
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'row' }}>
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
                                            {isGlobal(pkg, pkg.projects) && (
                                                <span
                                                    title="GlobalPackageReference: every project gets it"
                                                    style={{
                                                        marginLeft: '6px',
                                                        padding: '0 4px',
                                                        borderRadius: '2px',
                                                        fontSize: '10px',
                                                        background: 'var(--vscode-badge-background)',
                                                        color: 'var(--vscode-badge-foreground)'
                                                    }}
                                                >
                                                    global
                                                </span>
                                            )}
                                            {advisoryBadges(getAdvisory?.(pkg)).map(badge => (
                                                <span
                                                    key={badge.kind}
                                                    title={badge.title}
                                                    style={{
                                                        marginLeft: '6px',
                                                        padding: '0 4px',
                                                        borderRadius: '2px',
                                                        fontSize: '10px',
                                                        background: badge.kind === 'vulnerable' ? 'var(--vscode-errorForeground)' : 'var(--vscode-editorWarning-foreground)',
                                                        color: 'var(--vscode-editor-background)'
                                                    }}
                                                >
                                                    {badge.text}
                                                </span>
                                            ))}
                                            {!!pkg.authors?.length && (
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

                                    {getNote?.(pkg) && (
                                        <div style={{
                                            fontSize: '11px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            fontStyle: 'italic',
                                            marginBottom: '2px'
                                        }}>
                                            {getNote(pkg)}
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
                                            overflow: 'hidden',
                                            overflowWrap: 'anywhere'
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
                                        // The highest installed version across all projects, with its source (override, global)
                                        const installed = pkg.projects
                                            .map(p => p.packages?.find(installedPkg => installedPkg.id.toLowerCase() === pkg.id.toLowerCase()))
                                            .filter((installedPkg): installedPkg is NonNullable<typeof installedPkg> => !!installedPkg);
                                        if (installed.length > 0) {
                                            const known = installed.filter(installedPkg => installedPkg.currentVersion);
                                            const maxInstalled = known.sort((a, b) => compare(a.currentVersion, b.currentVersion))[0] ?? installed[0];

                                            // Always show the max installed version when package is installed
                                            return (
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    marginTop: '1px'
                                                }}>
                                                    {versionLabel(maxInstalled)}
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