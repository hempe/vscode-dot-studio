import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../../core/logger';
import { NodeId, NodeIdService } from '../nodeIdService';
import { createDotnetTask, DOTNET_TASK_TYPE } from '../../build/dotnetTaskProvider';
import { ProjectFileEditor } from '../../../parsers/projectFileEditor';
import { addProjectReferences } from '../../project/projectReferences';
import { removeDependencyEdit } from '../../project/dependencyRemoval';
import { uninstallPackages } from '../../nuget/centralPackageOperations';

const log = logger('referenceActions');

/**
 * Handles managing NuGet packages for a project
 */
export async function handleManageNuGetPackages(nodeId: NodeId): Promise<void> {
    try {
        // Extract project path from nodeId
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }

        log.info(`Managing NuGet packages for project: ${projectPath}`);

        // Open NuGet Package Manager in the main editor area for this specific project
        await vscode.commands.executeCommand('shinobi.openNuGetManager', projectPath);
        log.info(`Opened NuGet Package Manager for: ${projectPath}`);
    } catch (error) {
        log.error('Error opening NuGet webview:', error);
        vscode.window.showErrorMessage(`Error opening NuGet webview: ${error}`);
    }
}

export async function handleManageNuGetPackagesForSolution(nodeId: NodeId): Promise<void> {
    try {
        // Extract solution path from nodeId
        const solutionPath = nodeId.path;
        if (!solutionPath) {
            log.error('Cannot extract solution path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine solution path');
            return;
        }

        log.info(`Managing NuGet packages for solution: ${solutionPath}`);

        // Open NuGet Package Manager in the main editor area for the entire solution
        await vscode.commands.executeCommand('shinobi.openNuGetManagerForSolution', solutionPath);
        log.info(`Opened NuGet Package Manager for solution: ${solutionPath}`);
    } catch (error) {
        log.error('Error opening solution NuGet manager:', error);
        vscode.window.showErrorMessage(`Error opening solution NuGet manager: ${error}`);
    }
}

/**
 * Handles adding a reference to a project
 */
export async function handleAddProjectReference(nodeId: NodeId): Promise<void> {
    try {
        // Extract project path from nodeId
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }
        log.info(`Adding project reference for project: ${projectPath}`);

        // Open file picker to select project file
        const projectUri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Add Project Reference',
            filters: {
                'Project Files': ['csproj', 'vbproj', 'fsproj']
            }
        });

        if (projectUri && projectUri[0]) {
            const referencePath = projectUri[0].fsPath;
            log.info(`Adding reference from ${path.basename(projectPath)} to ${path.basename(referencePath)}`);

            // The same checks as the drop onto Dependencies (itself, already referenced, a circle), no shell
            await addDroppedReferences(projectPath, [referencePath]);
        }
    } catch (error) {
        log.error('Error adding project reference:', error);
        vscode.window.showErrorMessage(`Error adding project reference: ${error}`);
    }
}

/**
 * Handles adding assembly (.dll) references to a project, written as <Reference> items with a HintPath
 */
export async function handleAddAssemblyReference(nodeId: NodeId): Promise<void> {
    try {
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }

        const assemblyUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(path.dirname(projectPath)),
            openLabel: 'Add Reference',
            filters: {
                'Assemblies': ['dll', 'exe']
            }
        });
        if (!assemblyUris?.length) {
            return;
        }

        let content = await fs.promises.readFile(projectPath, 'utf8');
        const added: string[] = [];
        for (const uri of assemblyUris) {
            const assemblyName = path.basename(uri.fsPath, path.extname(uri.fsPath));
            const hintPath = path.relative(path.dirname(projectPath), uri.fsPath).split(path.sep).join('/');
            try {
                content = ProjectFileEditor.addAssemblyReference(content, assemblyName, hintPath);
                added.push(assemblyName);
            } catch (error) {
                vscode.window.showWarningMessage(`${error instanceof Error ? error.message : error}`);
            }
        }

        if (added.length > 0) {
            await fs.promises.writeFile(projectPath, content, 'utf8');
            const projectName = path.basename(projectPath, path.extname(projectPath));
            log.info(`Added assembly references to ${projectName}: ${added.join(', ')}`);
        }
    } catch (error) {
        log.error('Error adding assembly reference:', error);
        vscode.window.showErrorMessage(`Error adding assembly reference: ${error}`);
    }
}

/**
 * Handles restoring dependencies for a project
 */
export async function handleRestoreDependencies(nodeId: NodeId): Promise<void> {
    try {
        // Extract project path from nodeId
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }
        log.info(`Restoring dependencies for project: ${projectPath}`);

        await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'restore', target: projectPath }));
        log.info(`Started restore task for ${projectPath}`);
    } catch (error) {
        log.error('Error restoring dependencies:', error);
        vscode.window.showErrorMessage(`Error restoring dependencies: ${error}`);
    }
}

/**
 * Handles removing a dependency from a project
 */
export async function handleRemoveDependency(nodeId: NodeId): Promise<void> {
    try {
        log.info(`Removing dependency with nodeId: ${nodeId}`);

        // Extract dependency information from nodeId
        const dependencyInfo = NodeIdService.getDependencyInfoFromNode(nodeId);
        if (!dependencyInfo) {
            log.error('Cannot extract dependency info from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine dependency information');
            return;
        }

        const { projectPath, dependencyName, dependencyType } = dependencyInfo;

        log.info(`Parsed dependency - Project: ${projectPath}, Type: ${dependencyType}, Name: ${dependencyName}`);

        // Confirm removal with user
        const result = await vscode.window.showWarningMessage(
            `Are you sure you want to remove ${dependencyName} from the project?`,
            { modal: true },
            'Remove'
        );

        if (result !== 'Remove') {
            return;
        }

        const projectName = require('path').basename(projectPath, require('path').extname(projectPath));

        // Remove the dependency by editing the .csproj file directly
        const success = await removeDependencyFromCsproj(projectPath, dependencyType, dependencyName);

        if (success) {
            log.info(`Successfully removed ${dependencyName} from ${projectName}`);
        } else {
            vscode.window.showErrorMessage(`Failed to remove ${dependencyName} from ${projectName}`);
        }

    } catch (error) {
        log.error('Error removing dependency:', error);
        vscode.window.showErrorMessage(`Error removing dependency: ${error}`);
    }
}

/**
 * Removes a dependency from a project: packages the way the NuGet manager does (Central Package Management, global
 * packages), the other references as a text edit of the project file that keeps comments and formatting
 */
export async function removeDependencyFromCsproj(projectPath: string, category: string, dependencyName: string): Promise<boolean> {
    try {
        if (category === 'packages') {
            const { cancelled, results } = await uninstallPackages(dependencyName, [projectPath]);
            return !cancelled && results.length > 0 && results.every(result => result.success);
        }
        const content = await fs.promises.readFile(projectPath, 'utf8');
        const edited = removeDependencyEdit(content, category, dependencyName);
        if (edited === undefined) {
            log.warn(`Dependency '${dependencyName}' not found in project file`);
            return false;
        }
        await fs.promises.writeFile(projectPath, edited, 'utf8');
        log.info(`Removed ${category} '${dependencyName}' from ${projectPath}`);
        return true;
    } catch (error) {
        log.error('Error editing the project file:', error);
        return false;
    }
}

/**
 * Projects dropped onto another project's Dependencies: project references, as in Visual Studio. Refused ones
 * (itself, already referenced, a circle) are named in a warning; `dotnet add reference` refuses incompatible target
 * frameworks, its message is shown. The project file watcher shows the new references.
 */
export async function addDroppedReferences(projectPath: string, references: readonly string[]): Promise<void> {
    const result = await addProjectReferences(projectPath, references);
    if (result.added.length > 0) {
        log.info(`Added project references to ${path.basename(projectPath)}: ${result.added.map(reference => path.basename(reference)).join(', ')}`);
    }
    if (result.refused.length > 0) {
        vscode.window.showWarningMessage(result.refused.join(' '));
    }
    if (result.error) {
        vscode.window.showErrorMessage(`Could not add the project reference: ${result.error}`);
    }
}
