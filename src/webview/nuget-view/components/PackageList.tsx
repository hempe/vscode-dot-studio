import React from 'react';
import { LoadingMessage } from '../../shared/LoadingBar';
import { LocalNuGetPackage, ensureArray, formatAuthors } from '../shared';

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
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 500,
                                    fontSize: '13px',
                                    color: 'var(--vscode-foreground)',
                                    marginBottom: '2px'
                                }}>
                                    {pkg.id}
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
                                        overflow: 'hidden',
                                        marginBottom: '4px'
                                    }}>
                                        {pkg.description}
                                    </div>
                                )}

                                {/* Version and download info */}
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '11px',
                                    color: 'var(--vscode-descriptionForeground)'
                                }}>
                                    <span>v{pkg.version}</span>
                                    {pkg.totalDownloads && (
                                        <span>{pkg.totalDownloads.toLocaleString()} downloads</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </>
    );
};