import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { ProjectActionType } from '../webview/solution-view/types';

const log = logger('SolutionActionService');

export interface MessageData {
    type?: string;
    newName?: string;
    [key: string]: any;
}

/**
 * Service responsible for handling all solution and project actions
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionActionService {

    /**
     * Handles a project action with the specified parameters
     */
    static async handleProjectAction(action: ProjectActionType, projectPath: string, data?: MessageData): Promise<void> {
        log.info(`Executing project action: ${action} on ${projectPath}`);

        switch (action) {
            case 'openFile':
                await this._handleOpenFile(projectPath);
                break;

            case 'contextMenu':
                log.info(`Context menu action for ${data?.type || 'unknown'} at ${projectPath}`);
                // Context menu actions are handled by the UI - this is just logging
                break;

            case 'rename':
                if (data?.newName) {
                    await this._handleRename(projectPath, data.newName, data.type, data.oldName);
                }
                break;

            case 'build':
                await this._handleBuild(projectPath, 'build');
                break;

            case 'rebuild':
                await this._handleBuild(projectPath, 'rebuild');
                break;

            case 'clean':
                await this._handleBuild(projectPath, 'clean');
                break;

            case 'restoreNugets':
                await this._handleBuild(projectPath, 'restore');
                break;

            case 'deleteFile':
                await this._handleDeleteFile(projectPath);
                break;

            case 'removeSolutionItem':
                await this._handleRemoveSolutionItem(projectPath);
                break;

            case 'revealInExplorer':
                await this._handleRevealInExplorer(projectPath);
                break;

            case 'addExistingProject':
                await this._handleAddExistingProject(projectPath);
                break;

            case 'addNewProject':
                await this._handleAddNewProject(projectPath);
                break;

            case 'startRename':
                // This action is handled by the UI - no backend action needed
                log.info(`Start rename action for: ${projectPath}`);
                break;

            case 'collapseParent':
                // This action is handled by the UI - no backend action needed
                log.info(`Collapse parent action for: ${projectPath}`);
                break;

            case 'manageNuGetPackages':
                await this._handleManageNuGetPackages(projectPath);
                break;

            case 'manageNuGetPackagesForSolution':
                await this._handleManageNuGetPackagesForSolution(projectPath);
                break;

            case 'addProjectReference':
                await this._handleAddProjectReference(projectPath);
                break;
            case 'addAssemblyReference':
                await this._handleAddAssemblyReference(projectPath);
                break;
            case 'addFrameworkReference':
                await this._handleAddFrameworkReference(projectPath);
                break;

            case 'restoreDependencies':
                await this._handleRestoreDependencies(projectPath);
                break;

            case 'removeDependency':
                await this._handleRemoveDependency(projectPath, data);
                break;

            case 'addSolutionFolder':
                await this._handleAddSolutionFolder(projectPath, data);
                break;

            case 'removeSolutionFolder':
                await this._handleRemoveSolutionFolder(projectPath, data);
                break;

            case 'addSolutionItem':
                await this._handleAddSolutionItem(projectPath, data);
                break;

            case 'removeProject':
                await this._handleRemoveProject(projectPath);
                break;

            case 'deleteProject':
                await this._handleDeleteProject(projectPath);
                break;

            default:
                log.warn(`Unknown project action: ${action}`);
                break;
        }
    }

    // Private action handlers

    private static async _handleOpenFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
        } catch (error) {
            log.error('Error opening file:', error);
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    private static async _handleRename(itemPath: string, newName: string, itemType?: string, oldName?: string): Promise<void> {
        log.info(`Renaming ${itemType || 'item'} from '${oldName}' to '${newName}' at path: ${itemPath}`);

        try {
            if (itemType === 'solutionFolder') {
                // Handle solution folder rename
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    await solution.renameSolutionFolder(itemPath, newName);
                    log.info(`Solution folder renamed successfully`);
                }
            } else {
                // Handle file/folder rename
                const oldPath = itemPath;
                const newPath = path.join(path.dirname(oldPath), newName);

                const oldUri = vscode.Uri.file(oldPath);
                const newUri = vscode.Uri.file(newPath);

                await vscode.workspace.fs.rename(oldUri, newUri);
                log.info(`File/folder renamed from ${oldPath} to ${newPath}`);
            }
        } catch (error) {
            log.error('Error renaming item:', error);
            vscode.window.showErrorMessage(`Error renaming: ${error}`);
        }
    }

    private static async _handleBuild(targetPath: string, action: 'build' | 'rebuild' | 'clean' | 'restore'): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Determine if this is a solution or project
            const isSolution = targetPath.endsWith('.sln');
            const targetName = path.basename(targetPath, isSolution ? '.sln' : path.extname(targetPath));
            const targetType = isSolution ? 'Solution' : 'Project';

            const terminal = vscode.window.createTerminal(`${action} ${targetType}: ${targetName}`);
            terminal.show();

            let command = '';
            switch (action) {
                case 'build':
                    command = `dotnet build "${targetPath}"`;
                    break;
                case 'rebuild':
                    command = `dotnet clean "${targetPath}" && dotnet build "${targetPath}"`;
                    break;
                case 'clean':
                    command = `dotnet clean "${targetPath}"`;
                    break;
                case 'restore':
                    command = `dotnet restore "${targetPath}"`;
                    break;
            }

            terminal.sendText(command);
            log.info(`Executed ${action} command for ${targetType}: ${command}`);
        } catch (error) {
            log.error(`Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }

    private static async _handleDeleteFile(filePath: string): Promise<void> {
        try {
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete '${path.basename(filePath)}'?`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                const uri = vscode.Uri.file(filePath);
                await vscode.workspace.fs.delete(uri);
                log.info(`File deleted: ${filePath}`);
                vscode.window.showInformationMessage(`File deleted: ${path.basename(filePath)}`);
            }
        } catch (error) {
            log.error('Error deleting file:', error);
            vscode.window.showErrorMessage(`Error deleting file: ${error}`);
        }
    }

    private static async _handleRemoveSolutionItem(itemPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            await solution.removeSolutionItem(itemPath);
            log.info(`Solution item removed: ${itemPath}`);
            vscode.window.showInformationMessage(`Solution item removed: ${path.basename(itemPath)}`);
        } catch (error) {
            log.error('Error removing solution item:', error);
            vscode.window.showErrorMessage(`Error removing solution item: ${error}`);
        }
    }

    private static async _handleRevealInExplorer(itemPath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(itemPath);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } catch (error) {
            log.error('Error revealing in explorer:', error);
            vscode.window.showErrorMessage(`Error revealing in explorer: ${error}`);
        }
    }

    private static async _handleAddExistingProject(solutionPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const projectFiles = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                filters: {
                    'Project Files': ['csproj', 'vbproj', 'fsproj']
                },
                openLabel: 'Add Project'
            });

            if (projectFiles && projectFiles[0]) {
                await solution.addProject(projectFiles[0].fsPath);
                log.info(`Existing project added: ${projectFiles[0].fsPath}`);
                vscode.window.showInformationMessage(`Project added: ${path.basename(projectFiles[0].fsPath)}`);
            }
        } catch (error) {
            log.error('Error adding existing project:', error);
            vscode.window.showErrorMessage(`Error adding existing project: ${error}`);
        }
    }

    private static async _handleAddNewProject(solutionPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Show a simple message for now - full implementation would require template selection
            vscode.window.showInformationMessage('Add new project functionality would be implemented here');
            log.info('Add new project action triggered');
        } catch (error) {
            log.error('Error adding new project:', error);
            vscode.window.showErrorMessage(`Error adding new project: ${error}`);
        }
    }

    private static async _handleAddSolutionFolder(solutionPath: string, data?: MessageData): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const folderName = await vscode.window.showInputBox({
                prompt: 'Enter solution folder name',
                placeHolder: 'Solution folder name'
            });

            if (folderName) {
                // If data contains parent folder info (from solution folder context menu), use it
                const parentFolderName = data?.name;
                await solution.addSolutionFolder(folderName, parentFolderName);
                const parentInfo = parentFolderName ? ` under '${parentFolderName}'` : '';
                log.info(`Solution folder added: ${folderName}${parentInfo}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' added${parentInfo}`);
            }
        } catch (error) {
            log.error('Error adding solution folder:', error);
            vscode.window.showErrorMessage(`Error adding solution folder: ${error}`);
        }
    }

    private static async _handleRemoveSolutionFolder(folderPath: string, data?: MessageData): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Try to get folder name from data first (safer), then fall back to path parsing
            const folderName = data?.name || path.basename(folderPath);
            const folderGuid = data?.guid;

            log.info(`Removing solution folder: name="${folderName}", guid="${folderGuid}"`);

            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to remove solution folder '${folderName}'?`,
                { modal: true },
                'Remove'
            );

            if (answer === 'Remove') {
                // Use GUID-based removal if available, otherwise fall back to name-based
                if (folderGuid) {
                    await this._removeSolutionFolderByGuid(solution, folderGuid, folderName);
                } else {
                    await solution.removeSolutionFolder(folderName);
                }
                log.info(`Solution folder removed: ${folderName}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' removed`);
            }
        } catch (error) {
            log.error('Error removing solution folder:', error);
            vscode.window.showErrorMessage(`Error removing solution folder: ${error}`);
        }
    }

    private static async _handleAddSolutionItem(folderPath: string, data?: MessageData): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const fileUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: 'Add to Solution'
            });

            if (fileUri && fileUri[0]) {
                // Try to get folder name from data first (safer), then fall back to path parsing
                const folderName = data?.name || path.basename(folderPath);
                const folderGuid = data?.guid;

                log.info(`Adding solution item to folder: name="${folderName}", guid="${folderGuid}"`);

                await solution.addSolutionItem(folderName, fileUri[0].fsPath);
                log.info(`Solution item added: ${fileUri[0].fsPath}`);
                vscode.window.showInformationMessage(`Solution item added: ${path.basename(fileUri[0].fsPath)}`);
            }
        } catch (error) {
            log.error('Error adding solution item:', error);
            vscode.window.showErrorMessage(`Error adding solution item: ${error}`);
        }
    }

    private static async _handleRemoveProject(projectPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const projectName = path.basename(projectPath, path.extname(projectPath));
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to remove project '${projectName}' from the solution?`,
                { modal: true },
                'Remove'
            );

            if (answer === 'Remove') {
                await solution.removeProject(projectPath);
                log.info(`Project removed from solution: ${projectPath}`);
                vscode.window.showInformationMessage(`Project '${projectName}' removed from solution`);
            }
        } catch (error) {
            log.error('Error removing project:', error);
            vscode.window.showErrorMessage(`Error removing project: ${error}`);
        }
    }

    private static async _handleDeleteProject(projectPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const projectName = path.basename(projectPath, path.extname(projectPath));
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete project '${projectName}' from disk? This action cannot be undone.`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                // First remove from solution
                await solution.removeProject(projectPath);

                // Then delete the project directory
                const projectDir = path.dirname(projectPath);
                const uri = vscode.Uri.file(projectDir);
                await vscode.workspace.fs.delete(uri, { recursive: true });

                log.info(`Project deleted: ${projectPath}`);
                vscode.window.showInformationMessage(`Project '${projectName}' deleted`);
            }
        } catch (error) {
            log.error('Error deleting project:', error);
            vscode.window.showErrorMessage(`Error deleting project: ${error}`);
        }
    }

    /**
     * Removes a solution folder by GUID (safer than name-based removal)
     */
    private static async _removeSolutionFolderByGuid(solution: any, folderGuid: string, folderName: string): Promise<void> {
        try {
            // For now, fall back to the name-based method since Solution class doesn't have GUID-based methods yet
            // TODO: Implement GUID-based removal in Solution class for better safety
            log.info(`Using name-based removal for GUID ${folderGuid} (name: ${folderName})`);
            await solution.removeSolutionFolder(folderName);
        } catch (error) {
            log.error(`Error in GUID-based solution folder removal:`, error);
            throw error;
        }
    }

    /**
     * Handles managing NuGet packages for a project
     */
    private static async _handleManageNuGetPackages(dependenciesPath: string): Promise<void> {
        try {
            // Extract project path from dependencies path (remove '/dependencies' suffix)
            const projectPath = dependenciesPath.replace('/dependencies', '');
            log.info(`Managing NuGet packages for project: ${projectPath}`);

            // Open NuGet Package Manager in the main editor area for this specific project
            await vscode.commands.executeCommand('dotnet.openNuGetManager', projectPath);
            log.info(`Opened NuGet Package Manager for: ${projectPath}`);
        } catch (error) {
            log.error('Error opening NuGet webview:', error);
            vscode.window.showErrorMessage(`Error opening NuGet webview: ${error}`);
        }
    }

    private static async _handleManageNuGetPackagesForSolution(solutionPath: string): Promise<void> {
        try {
            log.info(`Managing NuGet packages for solution: ${solutionPath}`);

            // Open NuGet Package Manager in the main editor area for the entire solution
            await vscode.commands.executeCommand('dotnet.openNuGetManagerForSolution', solutionPath);
            log.info(`Opened NuGet Package Manager for solution: ${solutionPath}`);
        } catch (error) {
            log.error('Error opening solution NuGet manager:', error);
            vscode.window.showErrorMessage(`Error opening solution NuGet manager: ${error}`);
        }
    }

    /**
     * Handles adding a reference to a project
     */
    private static async _handleAddProjectReference(dependenciesPath: string): Promise<void> {
        try {
            // Extract project path from dependencies path
            const projectPath = dependenciesPath.replace('/dependencies', '');
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
                const projectName = path.basename(projectPath, path.extname(projectPath));
                const referenceName = path.basename(referencePath, path.extname(referencePath));

                log.info(`Adding reference from ${projectName} to ${referenceName}`);

                // Use dotnet CLI to add the project reference
                const terminal = vscode.window.createTerminal(`Add Project Reference: ${projectName}`);
                terminal.show();
                terminal.sendText(`dotnet add "${projectPath}" reference "${referencePath}"`);

                vscode.window.showInformationMessage(`Adding project reference from ${projectName} to ${referenceName}`);
            }
        } catch (error) {
            log.error('Error adding project reference:', error);
            vscode.window.showErrorMessage(`Error adding project reference: ${error}`);
        }
    }

    private static async _handleAddAssemblyReference(dependenciesPath: string): Promise<void> {
        try {
            // Extract project path from dependencies path
            const projectPath = dependenciesPath.replace('/dependencies', '');
            log.info(`Adding assembly reference for project: ${projectPath}`);

            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));
            const terminal = vscode.window.createTerminal(`Add Assembly Reference: ${projectName}`);
            terminal.show();

            terminal.sendText('# Add Assembly Reference:');
            terminal.sendText('# dotnet add reference <path-to-assembly.dll>');
            terminal.sendText(`# Current project: ${projectPath}`);

            log.info(`Opened assembly reference management for: ${projectPath}`);
        } catch (error) {
            log.error('Error adding assembly reference:', error);
            vscode.window.showErrorMessage(`Error adding assembly reference: ${error}`);
        }
    }

    private static async _handleAddFrameworkReference(dependenciesPath: string): Promise<void> {
        try {
            // Extract project path from dependencies path
            const projectPath = dependenciesPath.replace('/dependencies', '');
            log.info(`Adding framework reference for project: ${projectPath}`);

            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));
            const terminal = vscode.window.createTerminal(`Add Framework Reference: ${projectName}`);
            terminal.show();

            terminal.sendText('# Add Framework Reference:');
            terminal.sendText('# dotnet add package <FrameworkPackage>');
            terminal.sendText('# Example: dotnet add package Microsoft.AspNetCore.App');
            terminal.sendText(`# Current project: ${projectPath}`);

            log.info(`Opened framework reference management for: ${projectPath}`);
        } catch (error) {
            log.error('Error adding framework reference:', error);
            vscode.window.showErrorMessage(`Error adding framework reference: ${error}`);
        }
    }

    /**
     * Handles restoring dependencies for a project
     */
    private static async _handleRestoreDependencies(dependenciesPath: string): Promise<void> {
        try {
            // Extract project path from dependencies path
            const projectPath = dependenciesPath.replace('/dependencies', '');
            log.info(`Restoring dependencies for project: ${projectPath}`);

            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));
            const terminal = vscode.window.createTerminal(`Restore: ${projectName}`);
            terminal.show();

            const command = `dotnet restore "${projectPath}"`;
            terminal.sendText(command);

            log.info(`Executed restore command: ${command}`);
            vscode.window.showInformationMessage(`Restoring dependencies for ${projectName}...`);
        } catch (error) {
            log.error('Error restoring dependencies:', error);
            vscode.window.showErrorMessage(`Error restoring dependencies: ${error}`);
        }
    }

    /**
     * Handles removing a dependency from a project
     */
    private static async _handleRemoveDependency(dependencyPath: string, data?: MessageData): Promise<void> {
        try {
            log.info(`Removing dependency: ${dependencyPath}`);

            // Parse the dependency path to extract information
            // Path format: /path/to/project.csproj/dependencies/packages/PackageName@Version
            // or: /path/to/project.csproj/dependencies/projects/ProjectName
            const pathParts = dependencyPath.split('/dependencies/');
            if (pathParts.length !== 2) {
                throw new Error('Invalid dependency path format');
            }

            const projectPath = pathParts[0];
            const dependencyInfo = pathParts[1]; // e.g., "packages/PackageName@Version"

            const [category, dependencyNameWithVersion] = dependencyInfo.split('/');
            if (!category || !dependencyNameWithVersion) {
                throw new Error('Could not parse dependency category and name');
            }

            // Extract dependency name (remove version for packages)
            const dependencyName = dependencyNameWithVersion.includes('@')
                ? dependencyNameWithVersion.split('@')[0]
                : dependencyNameWithVersion;

            log.info(`Parsed dependency - Project: ${projectPath}, Category: ${category}, Name: ${dependencyName}`);

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
            const success = await this._removeDependencyFromCsproj(projectPath, category, dependencyName);

            if (success) {
                log.info(`Successfully removed ${dependencyName} from ${projectName}`);
                vscode.window.showInformationMessage(`Removed ${dependencyName} from ${projectName}`);
            } else {
                vscode.window.showErrorMessage(`Failed to remove ${dependencyName} from ${projectName}`);
            }

        } catch (error) {
            log.error('Error removing dependency:', error);
            vscode.window.showErrorMessage(`Error removing dependency: ${error}`);
        }
    }

    /**
     * Removes a dependency from a .csproj file by directly editing the XML
     */
    private static async _removeDependencyFromCsproj(projectPath: string, category: string, dependencyName: string): Promise<boolean> {
        try {
            const fs = require('fs').promises;
            const { parseStringPromise } = require('xml2js');
            const xml2js = require('xml2js');

            // Read the project file
            const projectContent = await fs.readFile(projectPath, 'utf8');

            // Check if the original file has an XML declaration
            const hasXmlDeclaration = projectContent.trimStart().startsWith('<?xml');
            log.info(`Original file has XML declaration: ${hasXmlDeclaration}`);

            const parsedXml = await parseStringPromise(projectContent);

            if (!parsedXml.Project) {
                log.error('Invalid project file format - no Project element');
                return false;
            }

            const project = parsedXml.Project;
            let removed = false;

            // Determine the XML element to look for based on category
            let elementName = '';
            switch (category) {
                case 'packages':
                    elementName = 'PackageReference';
                    break;
                case 'projects':
                    elementName = 'ProjectReference';
                    break;
                case 'assemblies':
                    elementName = 'Reference';
                    break;
                case 'frameworks':
                    elementName = 'FrameworkReference';
                    break;
                default:
                    log.error(`Unknown dependency category: ${category}`);
                    return false;
            }

            // Find and remove the dependency from ItemGroup elements
            if (project.ItemGroup) {
                for (let i = 0; i < project.ItemGroup.length; i++) {
                    const itemGroup = project.ItemGroup[i];

                    if (itemGroup[elementName]) {
                        const dependencies = itemGroup[elementName];

                        // Debug: Log all dependencies of this type
                        log.info(`Found ${dependencies.length} ${elementName} items in project:`);
                        dependencies.forEach((dep: any, index: number) => {
                            const include = dep.$ && dep.$.Include;
                            log.info(`  [${index}] Include: "${include}"`);
                        });

                        // Filter out the dependency to remove
                        const filtered = dependencies.filter((dep: any) => {
                            const include = dep.$ && dep.$.Include;

                            if (category === 'packages') {
                                // For packages, match by package name exactly
                                return include !== dependencyName;
                            } else if (category === 'projects') {
                                // For project references, try multiple matching strategies
                                if (!include) return true; // Keep if no Include attribute

                                log.debug(`Checking project reference: "${include}" against "${dependencyName}"`);

                                // Extract project name from various possible formats
                                const projectFileName = require('path').basename(include); // e.g., "Shinobi.WebSockets.csproj"
                                const projectNameFromFile = require('path').basename(include, '.csproj'); // e.g., "Shinobi.WebSockets"
                                const projectNameFromPath = include.split('/').pop()?.replace('.csproj', '') || ''; // Handle forward slashes

                                // Check if any of these match the dependency name
                                const matches = include === dependencyName ||
                                    projectFileName === dependencyName ||
                                    projectNameFromFile === dependencyName ||
                                    projectNameFromPath === dependencyName ||
                                    include.includes(dependencyName + '.csproj') ||
                                    include.endsWith('/' + dependencyName + '.csproj') ||
                                    include.endsWith('\\' + dependencyName + '.csproj');

                                log.debug(`Project reference match check: ${matches ? 'MATCH' : 'NO MATCH'}`);
                                log.debug(`  - include: "${include}"`);
                                log.debug(`  - projectFileName: "${projectFileName}"`);
                                log.debug(`  - projectNameFromFile: "${projectNameFromFile}"`);
                                log.debug(`  - projectNameFromPath: "${projectNameFromPath}"`);

                                return !matches; // Return false (remove) if it matches
                            } else {
                                // For assemblies and frameworks, match by name
                                return include !== dependencyName;
                            }
                        });

                        if (filtered.length < dependencies.length) {
                            removed = true;
                            log.info(`Removed ${elementName} '${dependencyName}' from project`);

                            if (filtered.length === 0) {
                                // Remove the entire element array if empty
                                delete itemGroup[elementName];

                                // Remove the entire ItemGroup if it's now empty
                                const remainingKeys = Object.keys(itemGroup).filter(key => key !== '$');
                                if (remainingKeys.length === 0) {
                                    project.ItemGroup.splice(i, 1);
                                    i--; // Adjust index after removal
                                }
                            } else {
                                // Update with filtered dependencies
                                itemGroup[elementName] = filtered;
                            }
                        }
                    }
                }
            }

            if (!removed) {
                log.warn(`Dependency '${dependencyName}' not found in project file`);
                return false;
            }

            // Build the XML back to string
            const builderOptions: any = {
                renderOpts: { pretty: true, indent: '  ' }
            };

            // Only include XML declaration if the original file had one
            if (hasXmlDeclaration) {
                builderOptions.xmldec = { version: '1.0', encoding: 'utf-8' };
                log.info('Including XML declaration in output');
            } else {
                // Explicitly disable XML declaration - use headless option for xml2js
                builderOptions.headless = true;
                log.info('Excluding XML declaration from output (using headless mode)');
            }

            log.debug('Builder options:', JSON.stringify(builderOptions));
            const builder = new xml2js.Builder(builderOptions);
            let xmlString = builder.buildObject(parsedXml);

            // Additional safety check - remove XML declaration if it shouldn't be there
            if (!hasXmlDeclaration && xmlString.startsWith('<?xml')) {
                xmlString = xmlString.replace(/^<\?xml[^>]*>\s*/, '');
                log.info('Removed XML declaration from output as safety measure');
            }

            log.debug('Final XML starts with:', xmlString.substring(0, 100));

            // Write the modified content back to the file
            await fs.writeFile(projectPath, xmlString, 'utf8');

            log.info(`Successfully updated project file: ${projectPath}`);
            return true;

        } catch (error) {
            log.error('Error editing .csproj file:', error);
            return false;
        }
    }
}