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
    loading?: boolean;
    onVersionChange: (version: string | any) => void;
    onInstallUpdate: (packageData: LocalNuGetPackage, projects: string[], version: string) => void;
    onUninstall: (packageData: LocalNuGetPackage, projects: string[]) => void;
    getVersionOptions: (pkg: LocalNuGetPackage) => Array<{ value: string; label: string }>;
    installButtonText?: string;
    totalProjects?: number; // To determine if we should show "from selected projects" text
}

export const PackageActions: React.FC<PackageActionsProps> = ({
    selectedPackage,
    selectedVersion,
    selectedProjects,
    initializing,
    loading = false,
    onVersionChange,
    onInstallUpdate,
    onUninstall,
    getVersionOptions,
    installButtonText = "Install",
    totalProjects = 1
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
                    disabled={initializing || loading}
                    style={{ flex: 1, maxWidth: '200px' }}
                />
                <Button
                    style={{ width: '120px', justifyContent: 'center' }}
                    appearance="primary"
                    disabled={selectedProjects.size === 0 || initializing || loading}
                    onClick={() => {
                        if (!initializing && !loading) {
                            const projectsList = Array.from(selectedProjects);
                            const versionToInstall = selectedVersion || selectedPackage.version;
                            log.info('Install/Update action:', {
                                package: selectedPackage.id,
                                version: versionToInstall,
                                projects: projectsList
                            });
                            onInstallUpdate(selectedPackage, projectsList, versionToInstall);
                        }
                    }}
                >
                    {loading ? 'Installing...' : installButtonText}
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
                    {totalProjects > 1 ? 'Remove package from selected projects:' : ''}
                </div>
                <Button
                    style={{ width: '120px', justifyContent: 'center' }}
                    appearance="secondary"
                    disabled={selectedProjects.size === 0 || initializing || loading}
                    onClick={() => {
                        if (!initializing && !loading) {
                            const projectsList = Array.from(selectedProjects);
                            log.info('Uninstall action:', {
                                package: selectedPackage.id,
                                projects: projectsList
                            });
                            onUninstall(selectedPackage, projectsList);
                        }
                    }}
                >
                    {loading ? 'Uninstalling...' : 'Uninstall'}
                </Button>
            </div>
        </div>
    );
};