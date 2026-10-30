import * as vscode from 'vscode';
import { Settings } from '../../../services/shared/settings';
import { addSource, listManagedSources, removeSource, setSourceEnabled, sourceProblem } from '../../../services/nuget/sourceManagement';
import { NuGetManagerService } from '../../../services/nuget/nugetManagerService';
import { SolutionService } from '../../../services/solution/solutionService';
import { logger } from '../../../core/logger';
import { LocalNuGetPackage, sendToUi } from '../../nuget-view/shared';
import { changePackageVersions, consolidatePackages, uninstallPackages } from '../../../services/nuget/centralPackageOperations';
import { BackendCmd, BulkConsolidatePackagesCmd, BulkUpdatePackagesCmd, InstallPackageCmd, SearchPackagesCmd, UnInstallPackageCmd } from '../../../types/commands/backend';
import { NuGetViewData } from '../../../types/commands/ui';
import { VersionUtils } from '../../../services/shared/versionUtils';
import { solutionWorkspaceFolder } from '../../../services/solution/workspaceFolders';

const log = logger('nugetMessageHandlers');


/** The manager needs the solution: when the workspace has one that is not open yet (the editor restored first), open it */
export async function ensureActiveSolution(): Promise<void> {
    if (SolutionService.getActiveSolution() || !solutionWorkspaceFolder()) {
        return;
    }
    const solution = await SolutionService.discoverAndInitializeSolution();
    if (solution) {
        log.debug(`Active solution initialized: ${solution.solutionPath}`);
    } else {
        log.warn('Failed to initialize active solution');
    }
}

/** What the handlers need from the editor provider: refreshing an open manager */
export interface NuGetHost {
    update(webview: vscode.Webview | null | undefined, context: { type: 'project' | 'solution', target: string }, includePrerelease: boolean): Promise<void>;
}

/** The Sources tab: only with the setting on, whatever the webview asks */
export async function handleSources(message: BackendCmd, webview: vscode.Webview): Promise<void> {
    if (!Settings.nugetPackageSources()) {
        return;
    }
    let error: string | undefined;
    try {
        switch (message.type) {
            case 'addSource': {
                const { name, url, location } = message.payload;
                const problem = sourceProblem(name, url, (await listManagedSources()).map(source => source.name));
                if (problem) {
                    error = problem;
                } else {
                    await addSource(name, url, location === 'solution' ? 'solution' : 'user');
                }
                break;
            }
            case 'removeSource': {
                const answer = await vscode.window.showWarningMessage(
                    `Remove the package source ${message.payload.name}? It is deleted from the NuGet.Config that adds it.`, { modal: true }, 'Remove');
                if (answer === 'Remove') {
                    await removeSource(message.payload.name);
                }
                break;
            }
            case 'setSourceEnabled':
                await setSourceEnabled(message.payload.name, message.payload.enabled === true);
                break;
        }
    } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        log.warn('Package source change failed:', caught);
    }
    sendToUi(webview, { type: 'packageSources', payload: { sources: await listManagedSources().catch(() => []), error } });
}

/**
 * Get NuGet data based on context (project vs solution)
 */
export async function getNuGetData(
    context: { type: 'project' | 'solution', target: string } | null | undefined,
    includePrerelease: boolean): Promise<NuGetViewData> {
    if (!context) {
        return {
            projects: [],
            installedPackages: [],
            updatesAvailable: null,
        };
    }

    try {
        log.debug(`_getNuGetData: ${context.type} ${context.target}`);
        await ensureActiveSolution();

        if (context.type === 'solution') {
            // Return solution-wide NuGet data
            const solutionData = await NuGetManagerService.getSolutionNuGetData(context.target, includePrerelease);
            return {
                updatesAvailable: solutionData.outdatedPackages,
                installedPackages: solutionData.installedPackages?.map(x => ({
                    ...x,
                    version: x.currentVersion
                })),
                transitivePackages: solutionData.transitivePackages,
                consolidatePackages: [],
                projects: solutionData.projects,
                searchResults: [],
            };
        } else {
            // Return project-specific NuGet data
            const projectData = await NuGetManagerService.getProjectNuGetData(context.target, includePrerelease);
            return {
                updatesAvailable: projectData.outdatedPackages,
                installedPackages: projectData.installedPackages?.map(x => ({
                    ...x,
                    version: x.currentVersion
                })),
                transitivePackages: projectData.transitivePackages,
                projectPath: projectData.projectPath,
                consolidatePackages: [],
                projects: projectData.projects,
                searchResults: [],
            };
        }
    } catch (error) {
        log.error('Error getting NuGet data:', error);
        return {};
    }
}

export async function handleSearchPackages(message: SearchPackagesCmd, webview: vscode.Webview) {
    try {
        // Extract query from both message formats
        const query = message.payload.query;

        const results = await NuGetManagerService.searchPackages(query, { source: message.payload.source });

        sendToUi(webview, {
            type: 'searchResults',
            payload: {
                searchResults: results,
            }
        });
    } catch (error) {
        log.error('Error searching packages:', error);
        sendToUi(webview, {
            type: 'searchResults',
            payload: {
                searchResults: [],
                error: error instanceof Error ? error.message : 'Search failed'
            }
        });
    }
}

export async function handleGetConsolidatePackages(
    webview: vscode.Webview,
    context: { type: 'project' | 'solution', target: string },
    includePrerelease: boolean) {
    try {
        if (context.type === 'solution') {
            // Lazy load consolidation data
            const consolidationData = await NuGetManagerService.getSolutionNuGetData(context.target, includePrerelease);
            sendToUi(webview, {
                type: 'consolidatePackages',
                payload: {
                    consolidatePackages: consolidationData.consolidatePackages
                }
            });
        } else {
            sendToUi(webview, {
                type: 'consolidatePackages',
                payload: {
                    consolidatePackages: []
                }
            });
        }
    } catch (error) {
        log.error('Error getting consolidate packages:', error);
        sendToUi(webview, {
            type: 'consolidatePackages',
            payload: {
                consolidatePackages: []
            }
        });
    }
}

export async function handleInstallPackage(message: InstallPackageCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }, host: NuGetHost) {
    try {
        const installData = message.payload;
        const installPackage = installData.package;
        const installProjects = installData.projects || [];
        const installVersion = installData.version;

        if (!installPackage || !installProjects.length) {
            vscode.window.showErrorMessage('No projects selected for installation');
            return;
        }

        log.debug(`Installing package ${installPackage.id} version ${installVersion} to projects:`, installProjects);

        // Central Package Management edits Directory.Packages.props (asking when that reaches other projects);
        // projects without it go through dotnet add package
        const { cancelled, results } = await changePackageVersions(
            [{ id: installPackage.id, version: installVersion, projects: installProjects }],
            installData.versionScope ?? 'shared'
        );
        if (cancelled) {
            sendToUi(webview, { type: 'installComplete', payload: { success: false, packageId: installPackage.id } });
            return;
        }

        // Process results and show appropriate messages (a central edit is one result for all its projects)
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        if (successful.length > 0) {
            vscode.window.showInformationMessage(failed.length === 0
                ? `Successfully installed ${installPackage.id}@${installVersion} in ${installProjects.length} project(s)`
                : `Installed ${installPackage.id}@${installVersion}, with errors`
            );
        }

        if (failed.length > 0) {
            log.error('Failed installations:', failed);
            vscode.window.showErrorMessage(
                `Failed to install ${installPackage.id} in ${failed.length} project(s). Check logs for details.`
            );
        }

        // Refresh the webview
        await host.update(webview, context, message.payload.includePrerelease);

        // Send completion message to clear loading state
        sendToUi(webview, {
            type: 'installComplete',
            payload: {
                success: successful.length > 0,
                packageId: installPackage.id
            }
        });
    } catch (error) {
        log.error('Error installing package:', error);
        vscode.window.showErrorMessage(`Failed to install package: ${error}`);
        sendToUi(webview, {
            type: 'installComplete',
            payload: {
                success: false,
                packageId: message.payload?.package?.id || 'unknown'

            }
        });
    }
}

export async function handleUninstallPackage(message: UnInstallPackageCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }, host: NuGetHost) {
    try {
        const uninstallData = message.payload;
        const uninstallPackage = uninstallData.package;
        const uninstallProjects = uninstallData.projects || [];

        if (!uninstallPackage || !uninstallProjects.length) {
            vscode.window.showErrorMessage('No projects selected for uninstallation');
            return;
        }

        log.debug(`Uninstalling package ${uninstallPackage.id} from projects:`, uninstallProjects);

        // dotnet remove package per project; a global package is removed or opted out in the props/project files
        const { cancelled, results } = await uninstallPackages(uninstallPackage.id, uninstallProjects);
        if (cancelled) {
            sendToUi(webview, { type: 'uninstallComplete', payload: { success: false, packageId: uninstallPackage.id } });
            return;
        }

        // Process results and show appropriate messages
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        if (successful.length > 0) {
            vscode.window.showInformationMessage(
                `Successfully uninstalled ${uninstallPackage.id} from ${successful.length} project(s)`
            );
        }

        if (failed.length > 0) {
            log.error('Failed uninstallations:', failed);
            vscode.window.showErrorMessage(
                `Failed to uninstall ${uninstallPackage.id} from ${failed.length} project(s). Check logs for details.`
            );
        }

        // Refresh the webview
        await host.update(webview, context, message.payload.includePrerelease);

        // Send completion message to clear loading state
        sendToUi(webview, {
            type: 'uninstallComplete',
            payload: {
                success: successful.length > 0,
                packageId: uninstallPackage.id
            }
        });
    } catch (error) {
        log.error('Error uninstalling package:', error);
        vscode.window.showErrorMessage(`Failed to uninstall package: ${error}`);
        // Send completion message even on error
        sendToUi(webview, {
            type: 'uninstallComplete',
            payload: {
                success: false,
                packageId: message.payload?.package?.id || 'unknown'
            }
        });
    }
}

export async function handleBulkUpdatePackages(message: BulkUpdatePackagesCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }, host: NuGetHost) {
    try {
        // Extract packages from both message formats
        const packages: LocalNuGetPackage[] = message.payload.packages;

        if (!packages || !Array.isArray(packages) || packages.length === 0) {
            vscode.window.showWarningMessage('No packages selected for update');
            return;
        }

        log.debug(`Bulk updating ${packages.length} packages`);

        // One change per package (central versions are edited once, not once per project), one confirmation for all
        const changes = packages.flatMap(pkg => {
            const version = pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0];
            const projects = context.type === 'project' ? [context.target] : (pkg.projects ?? []).map(project => project.path);
            return version && projects.length > 0 ? [{ id: pkg.id, version, projects }] : [];
        });

        // Show progress notification
        const cancelled = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${changes.length} package(s)`,
            cancellable: false
        }, async () => {
            const { cancelled, results } = await changePackageVersions(changes);
            if (cancelled) {
                return true;
            }

            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;

            if (failed === 0) {
                vscode.window.showInformationMessage(`Successfully updated ${successful} packages`);
            } else if (successful === 0) {
                vscode.window.showErrorMessage(`Failed to update all ${failed} packages`);
            } else {
                vscode.window.showWarningMessage(`Updated ${successful} packages, ${failed} failed`);
            }
            return false;
        });

        // The Installed and Updates tabs show the new versions
        if (!cancelled) {
            await host.update(webview, context, message.payload.includePrerelease);
        }

        // Send completion message to frontend
        sendToUi(webview, {
            type: 'bulkUpdateComplete',
            payload: {
                success: !cancelled
            }
        });

    } catch (error) {
        log.error('Error performing bulk package updates:', error);
        vscode.window.showErrorMessage(`Error updating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Send failure completion message
        sendToUi(webview, {
            type: 'bulkUpdateComplete',
            payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        });
    }
}

export async function handleBulkConsolidatePackages(message: BulkConsolidatePackagesCmd, webview: vscode.Webview, context: { type: 'project' | 'solution', target: string }, host: NuGetHost) {
    try {
        // Extract packages from both message formats
        const packages: LocalNuGetPackage[] = message.payload.packages;

        if (!packages || !Array.isArray(packages) || packages.length === 0) {
            vscode.window.showWarningMessage('No packages selected for consolidation');
            return;
        }

        log.debug(`Bulk consolidating ${packages.length} packages`);

        if (context.type !== 'solution') {
            vscode.window.showWarningMessage('Consolidation needs the solution, not a single project');
            sendToUi(webview, { type: 'bulkConsolidateComplete', payload: { success: false } });
            return;
        }
        // The target of each package: its newest version (prerelease as chosen), else the one it has
        const changes = packages.map(pkg => ({
            id: pkg.id,
            version: pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0]
                || pkg.currentVersion,
        }));

        // Show progress notification
        const cancelled = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Consolidating`,
            cancellable: false
        }, async () => {
            // Under CPM: one confirmation, the central version set, the overrides removed
            const { cancelled, results } = await consolidatePackages(changes);
            if (cancelled) {
                return true;
            }

            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;

            if (failed === 0) {
                vscode.window.showInformationMessage(`Successfully consolidated ${successful} packages`);
            } else if (successful === 0) {
                vscode.window.showErrorMessage(`Failed to consolidate all ${failed} packages`);
            } else {
                vscode.window.showWarningMessage(`Consolidated ${successful} packages, ${failed} failed`);
            }
            return false;
        });

        // Refresh the consolidate tab data, and the Installed and Updates tabs (they show the versions consolidated)
        await handleGetConsolidatePackages(webview, context, message.payload.includePrerelease);
        if (!cancelled) {
            await host.update(webview, context, message.payload.includePrerelease);
        }

        // Send completion message to frontend
        sendToUi(webview, {
            type: 'bulkConsolidateComplete',
            payload: {
                success: !cancelled
            }
        });

    } catch (error) {
        log.error('Error performing bulk package consolidation:', error);
        vscode.window.showErrorMessage(`Error consolidating packages: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Send failure completion message
        sendToUi(webview, {
            type: 'bulkConsolidateComplete',
            payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        });
    }
}

/**
 * Get a package icon and send it to the webview
 */
export async function getPackageIcon(packageId: string, version: string, webview: vscode.Webview): Promise<void> {
    try {
        // Use direct NuGet icon URL instead of caching, when nuget.org is a source at all
        const iconUri = !await NuGetManagerService.usesNuGetOrg() ? null : `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/${version}/icon`;
        sendToUi(webview, {
            type: 'packageIcon',
            payload: {
                packageId,
                version,
                iconUri
            }
        });
    } catch (error) {
        log.error(`Error getting icon for ${packageId}@${version}:`, error);

        sendToUi(webview, {
            type: 'packageIcon',
            payload: {
                packageId,
                version,
                iconUri: null
            }
        });
    }
}

/**
 * Get a package README URL and send it to the webview
 */
export async function getPackageReadme(packageId: string, version: string, webview: vscode.Webview): Promise<void> {
    try {
        // Use direct NuGet README URL, when nuget.org is a source at all
        const readmeUrl = !await NuGetManagerService.usesNuGetOrg() ? null : `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/${version}/readme`;

        sendToUi(webview, {
            type: 'packageReadme',
            payload: {
                packageId,
                version,
                readmeUrl
            }
        });
    } catch (error) {
        log.error(`Error getting README for ${packageId}@${version}:`, error);

        sendToUi(webview, {
            type: 'packageReadme',
            payload: {
                packageId,
                version,
                readmeUrl: null
            }
        });
    }
}
