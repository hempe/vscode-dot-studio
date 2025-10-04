import React from 'react';
import { LoadingMessage } from '../../shared/LoadingBar';
import { LocalNuGetPackage, ensureArray, formatAuthors } from '../shared';
import { logger } from '../../shared/logger';

const log = logger('PackageList');


interface PackageListProps {
    packages: LocalNuGetPackage[];
    loading?: boolean;
    emptyMessage: string;
    loadingMessage?: string;
    searchTerm?: string;
    hasSearched?: boolean;
    selectedIndex: number;
    selectedPackage: LocalNuGetPackage | null;
    selectedItemRef: React.RefObject<HTMLDivElement>;
    onPackageSelect: (pkg: LocalNuGetPackage, index: number) => void;
    getUniquePackages: (packages: LocalNuGetPackage[]) => LocalNuGetPackage[];
    getPackageIconUrl: (pkg: LocalNuGetPackage) => string;
    showUpdateInfo?: boolean; // For Updates tab to show version changes
    getVersionChangeText?: (pkg: LocalNuGetPackage) => string;
    title: string;
}

export const PackageList: React.FC<PackageListProps> = ({
    packages,
    loading = false,
    emptyMessage,
    loadingMessage = "Loading packages...",
    searchTerm = '',
    hasSearched = false,
    selectedIndex,
    selectedPackage,
    selectedItemRef,
    onPackageSelect,
    getUniquePackages,
    getPackageIconUrl,
    showUpdateInfo = false,
    getVersionChangeText,
    title
}) => {
    const uniquePackages = getUniquePackages(ensureArray(packages));

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
                        key={`${pkg.id}-${pkg.version}`}
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
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                {/* Top row: Package name with authors and version */}
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
                                            v{pkg.version}
                                        </div>
                                        {/* Max installed version - only show if different from current and package has projects */}
                                        {pkg.projects && pkg.projects.length > 0 && (() => {
                                            // Debug logging
                                            log.shotgun(`${pkg.id} has projects:`, pkg.projects);

                                            // Find the highest installed version across all projects
                                            const installedVersions = pkg.projects.map(p => p.version).filter(Boolean);
                                            log.shotgun(`${pkg.id} installed versions:`, installedVersions);
                                            if (installedVersions.length > 0) {
                                                const maxInstalledVersion = installedVersions.sort((a, b) => {
                                                    const aParts = a.split('.').map(Number);
                                                    const bParts = b.split('.').map(Number);
                                                    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                                                        const aPart = aParts[i] || 0;
                                                        const bPart = bParts[i] || 0;
                                                        if (aPart !== bPart) return bPart - aPart;
                                                    }
                                                    return 0;
                                                })[0];

                                                // Only show if different from the main version
                                                if (maxInstalledVersion !== pkg.version) {
                                                    return (
                                                        <div style={{
                                                            fontSize: '11px',
                                                            color: 'var(--vscode-descriptionForeground)',
                                                            marginTop: '1px'
                                                        }}>
                                                            max installed: v{maxInstalledVersion}
                                                        </div>
                                                    );
                                                }
                                            }
                                            return null;
                                        })()}
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
                        </div>
                    </div>
                ))
            )}
        </>
    );
};