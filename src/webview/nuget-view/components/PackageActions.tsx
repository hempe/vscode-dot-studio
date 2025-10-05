import React from 'react';
import { LocalNuGetPackage } from '../shared';
import { Button, Dropdown } from 'vscrui';
import { logger } from '../../shared/logger';

const log = logger('PackageActions');

interface PackageActionsProps {
    selectedPackage: LocalNuGetPackage;
    selectedVersion: string | null;
    selectedProjects: Set<string>;
    initializing: boolean;
    onVersionChange: (version: string | any) => void;
    onInstallUpdate: (packageData: LocalNuGetPackage) => void;
    onUninstall: (packageData: LocalNuGetPackage) => void;
    getVersionOptions: (pkg: LocalNuGetPackage) => Array<{ value: string; label: string }>;
    installButtonText?: string;
}

export const PackageActions: React.FC<PackageActionsProps> = ({
    selectedPackage,
    selectedVersion,
    selectedProjects,
    initializing,
    onVersionChange,
    onInstallUpdate,
    onUninstall,
    getVersionOptions,
    installButtonText = "Install"
}) => {
    return (
        <div style={{
            background: 'var(--vscode-panel-background)',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '4px',
            padding: '8px 16px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
        }}>
            {/* Installed Section */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
            }}>
                <div style={{
                    fontSize: '14px',
                    whiteSpace: 'nowrap',
                    flex: 1,
                }}>
                    Version:
                </div>
                <Dropdown
                    value={selectedVersion || selectedPackage.version}
                    onChange={onVersionChange}
                    options={getVersionOptions(selectedPackage)}
                    disabled={initializing}
                    style={{ flex: 1, maxWidth: '200px' }}
                />
                <Button
                    style={{ width: '120px', justifyContent: 'center' }}
                    appearance="primary"
                    disabled={selectedProjects.size === 0 || initializing}
                    onClick={() => {
                        if (!initializing) {
                            log.info('Install/Update action:', {
                                package: selectedPackage.id,
                                version: selectedVersion || selectedPackage.version,
                                projects: Array.from(selectedProjects)
                            });
                            onInstallUpdate(selectedPackage);
                        }
                    }}
                >
                    {installButtonText}
                </Button>
            </div>

            {/* Uninstall Section */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
            }}>
                <div style={{
                    fontSize: '14px',
                    flex: 1,
                }}>
                    Remove package from selected projects:
                </div>
                <Button
                    style={{ width: '120px', justifyContent: 'center' }}
                    appearance="secondary"
                    disabled={selectedProjects.size === 0 || initializing}
                    onClick={() => {
                        if (!initializing) {
                            log.info('Uninstall action:', {
                                package: selectedPackage.id,
                                projects: Array.from(selectedProjects)
                            });
                            onUninstall(selectedPackage);
                        }
                    }}
                >
                    Uninstall
                </Button>
            </div>
        </div>
    );
};