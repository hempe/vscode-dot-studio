import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';

const log = logger('NamespaceService');

export interface NamespaceInfo {
    namespace: string | null;
    isFileScoped: boolean;
    line: number;
    position: vscode.Position;
}

/**
 * Service for handling namespace operations including detection,
 * parsing, and updates via OmniSharp LSP integration
 */
export class NamespaceService {

    /**
     * Parses a C# file to extract namespace information
     */
    static async parseNamespaceFromFile(filePath: string): Promise<NamespaceInfo | null> {
        try {
            if (!filePath.endsWith('.cs')) {
                return null;
            }

            const content = await fs.promises.readFile(filePath, 'utf8');
            return this.parseNamespaceFromContent(content);
        } catch (error) {
            log.error(`Error reading file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Parses namespace information from C# file content
     */
    static parseNamespaceFromContent(content: string): NamespaceInfo | null {
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and comments
            if (!line || line.startsWith('//') || line.startsWith('/*')) {
                continue;
            }

            // Skip using statements
            if (line.startsWith('using ')) {
                continue;
            }

            // Check for file-scoped namespace (ends with semicolon)
            const fileScopedMatch = line.match(/^namespace\s+([\w\.]+)\s*;/);
            if (fileScopedMatch) {
                const namespace = fileScopedMatch[1];
                const position = new vscode.Position(i, line.indexOf('namespace') + 'namespace'.length + 1);
                return {
                    namespace,
                    isFileScoped: true,
                    line: i,
                    position
                };
            }

            // Check for traditional namespace (with opening brace on same line or next line)
            const traditionalMatchSameLine = line.match(/^namespace\s+([\w\.]+)\s*\{/);
            if (traditionalMatchSameLine) {
                const namespace = traditionalMatchSameLine[1];
                const position = new vscode.Position(i, line.indexOf('namespace') + 'namespace'.length + 1);
                return {
                    namespace,
                    isFileScoped: false,
                    line: i,
                    position
                };
            }

            // Check for traditional namespace (with opening brace on next line)
            const traditionalMatchNextLine = line.match(/^namespace\s+([\w\.]+)\s*$/);
            if (traditionalMatchNextLine && i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                if (nextLine === '{') {
                    const namespace = traditionalMatchNextLine[1];
                    const position = new vscode.Position(i, line.indexOf('namespace') + 'namespace'.length + 1);
                    return {
                        namespace,
                        isFileScoped: false,
                        line: i,
                        position
                    };
                }
            }

            // If we hit a class, interface, struct, etc. without a namespace, it's in the global namespace
            if (line.match(/^(public\s+|private\s+|internal\s+|protected\s+)?(partial\s+)?(class|interface|struct|enum|record)\s+/)) {
                break;
            }
        }

        return null; // No namespace found (global namespace)
    }

    /**
     * Calculates the expected namespace based on folder structure and project settings
     */
    static async calculateExpectedNamespace(filePath: string, projectPath?: string): Promise<string | null> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                log.warn('No active solution found');
                return null;
            }

            let resolvedProjectPath = projectPath;

            // If no project path provided, find the project that contains this file
            if (!resolvedProjectPath) {
                const project = await this.findProjectForFile(filePath);
                if (!project) {
                    log.warn(`No project found for file: ${filePath}`);
                    return null;
                }
                resolvedProjectPath = project.path;
            }

            log.debug(`Using project path: ${resolvedProjectPath} for file: ${filePath}`);

            // Get the project's root namespace
            const rootNamespace = await this.getProjectRootNamespace(resolvedProjectPath);
            if (!rootNamespace) {
                log.warn(`No root namespace found for project: ${resolvedProjectPath}`);
                return null;
            }

            log.debug(`Root namespace: ${rootNamespace}`);

            // Calculate relative path from project root to file's directory
            const projectDir = path.dirname(resolvedProjectPath);
            const fileDir = path.dirname(filePath);
            const relativePath = path.relative(projectDir, fileDir);

            log.debug(`Project dir: ${projectDir}, File dir: ${fileDir}, Relative path: ${relativePath}`);

            if (!relativePath || relativePath === '.') {
                // File is in project root
                log.debug(`File is in project root, returning root namespace: ${rootNamespace}`);
                return rootNamespace;
            }

            // Convert path separators to namespace separators
            const namespaceParts = relativePath.split(path.sep).filter(part => part && part !== '.');
            const expectedNamespace = rootNamespace + '.' + namespaceParts.join('.');
            log.debug(`Expected namespace: ${expectedNamespace}`);
            return expectedNamespace;

        } catch (error) {
            log.error(`Error calculating expected namespace for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Finds the project that contains the given file
     */
    private static async findProjectForFile(filePath: string): Promise<{ path: string; name: string } | null> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) return null;

        // Get all .NET projects from the solution
        const projects = solution.getDotNetProjects();
        log.debug(`Found ${projects.length} .NET projects in solution`);

        for (const project of projects) {
            const projectPath = project.projectPath;
            const projectDir = path.dirname(projectPath);
            log.debug(`Checking project: ${project.name} at ${projectPath}`);

            // Check if file is within this project directory
            const relativePath = path.relative(projectDir, filePath);
            log.debug(`Relative path from ${projectDir} to ${filePath}: ${relativePath}`);

            if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                log.debug(`File ${filePath} belongs to project: ${project.name}`);
                return {
                    path: projectPath,
                    name: project.name
                };
            }
        }

        log.debug(`No project found for file: ${filePath}`);
        return null;
    }

    /**
     * Extracts the root namespace from a project file
     */
    private static async getProjectRootNamespace(projectPath: string): Promise<string | null> {
        try {
            const content = await fs.promises.readFile(projectPath, 'utf8');

            // Look for RootNamespace property
            const rootNamespaceMatch = content.match(/<RootNamespace>(.*?)<\/RootNamespace>/);
            if (rootNamespaceMatch) {
                return rootNamespaceMatch[1].trim();
            }

            // Look for AssemblyName as fallback
            const assemblyNameMatch = content.match(/<AssemblyName>(.*?)<\/AssemblyName>/);
            if (assemblyNameMatch) {
                return assemblyNameMatch[1].trim();
            }

            // Default to project file name without extension
            const projectName = path.basename(projectPath, path.extname(projectPath));
            return projectName;

        } catch (error) {
            log.error(`Error reading project file ${projectPath}:`, error);
            return null;
        }
    }

    /**
     * Updates namespace using VS Code's rename provider (OmniSharp integration)
     * Falls back to manual text replacement if OmniSharp fails
     */
    static async updateNamespaceViaRename(filePath: string, oldNamespace: string, newNamespace: string): Promise<boolean> {
        try {
            // First try OmniSharp rename provider
            const omnisharpSuccess = await this._tryOmnisharpRename(filePath, oldNamespace, newNamespace);
            if (omnisharpSuccess) {
                return true;
            }

            // Fallback to manual namespace replacement
            log.info(`OmniSharp rename failed, falling back to manual namespace update for ${filePath}`);
            return await this._manualNamespaceUpdate(filePath, oldNamespace, newNamespace);

        } catch (error) {
            log.error(`Error updating namespace in ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Attempts to update namespace using OmniSharp rename provider
     */
    private static async _tryOmnisharpRename(filePath: string, oldNamespace: string, newNamespace: string): Promise<boolean> {
        try {
            log.debug(`Attempting OmniSharp rename for ${filePath}: ${oldNamespace} -> ${newNamespace}`);

            // Open the document in VS Code and show it in editor
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, { preview: false });

            // Parse the file to find the namespace position
            const namespaceInfo = this.parseNamespaceFromContent(document.getText());
            if (!namespaceInfo || namespaceInfo.namespace !== oldNamespace) {
                log.error(`Namespace mismatch in file ${filePath}. Expected: ${oldNamespace}, Found: ${namespaceInfo?.namespace}`);
                return false;
            }

            log.debug(`Found namespace at position: line ${namespaceInfo.position.line}, character ${namespaceInfo.position.character}`);

            // Execute the rename operation via OmniSharp
            const workspaceEdit = await vscode.commands.executeCommand(
                'vscode.executeDocumentRenameProvider',
                document.uri,
                namespaceInfo.position,
                newNamespace
            ) as vscode.WorkspaceEdit;

            if (!workspaceEdit) {
                log.warn(`No workspace edit returned for namespace rename from ${oldNamespace} to ${newNamespace}`);
                return false;
            }

            // Apply the workspace edit
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            if (success) {
                log.info(`Successfully renamed namespace via OmniSharp from ${oldNamespace} to ${newNamespace} in ${filePath}`);
                return true;
            } else {
                log.error(`Failed to apply workspace edit for namespace rename in ${filePath}`);
                return false;
            }

        } catch (error) {
            log.warn(`OmniSharp rename failed for ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Manually updates namespace by direct text replacement
     */
    private static async _manualNamespaceUpdate(filePath: string, oldNamespace: string, newNamespace: string): Promise<boolean> {
        try {
            log.debug(`Performing manual namespace update for ${filePath}: ${oldNamespace} -> ${newNamespace}`);

            // Read the file content
            const content = await fs.promises.readFile(filePath, 'utf8');

            // Parse to get namespace info
            const namespaceInfo = this.parseNamespaceFromContent(content);
            if (!namespaceInfo || namespaceInfo.namespace !== oldNamespace) {
                log.error(`Namespace mismatch in file ${filePath}. Expected: ${oldNamespace}, Found: ${namespaceInfo?.namespace}`);
                return false;
            }

            // Create the replacement patterns
            let updatedContent: string;

            if (namespaceInfo.isFileScoped) {
                // File-scoped namespace: "namespace MyProject.Services;"
                const pattern = new RegExp(`^(\\s*namespace\\s+)${this._escapeRegex(oldNamespace)}(\\s*;)`, 'm');
                updatedContent = content.replace(pattern, `$1${newNamespace}$2`);
            } else {
                // Traditional namespace: "namespace MyProject.Services" (with brace on same or next line)
                const pattern = new RegExp(`^(\\s*namespace\\s+)${this._escapeRegex(oldNamespace)}(\\s*\\{?)`, 'm');
                updatedContent = content.replace(pattern, `$1${newNamespace}$2`);
            }

            // Check if replacement was made
            if (updatedContent === content) {
                log.error(`Failed to replace namespace ${oldNamespace} with ${newNamespace} in ${filePath}`);
                return false;
            }

            // Write the updated content back to file
            await fs.promises.writeFile(filePath, updatedContent, 'utf8');

            log.info(`Successfully updated namespace manually from ${oldNamespace} to ${newNamespace} in ${filePath}`);
            return true;

        } catch (error) {
            log.error(`Error in manual namespace update for ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Escapes special regex characters in a string
     */
    private static _escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Checks if a file move/rename requires namespace updates
     */
    static async analyzeNamespaceChanges(filePath: string, projectPath?: string): Promise<{
        needsUpdate: boolean;
        currentNamespace: string | null;
        expectedNamespace: string | null;
        namespaceInfo: NamespaceInfo | null;
    }> {
        log.debug(`analyzeNamespaceChanges called for: ${filePath} with project: ${projectPath}`);

        const namespaceInfo = await this.parseNamespaceFromFile(filePath);
        log.debug(`Parsed namespace info: ${JSON.stringify(namespaceInfo)}`);

        const expectedNamespace = await this.calculateExpectedNamespace(filePath, projectPath);
        log.debug(`Calculated expected namespace: ${expectedNamespace}`);

        const currentNamespace = namespaceInfo?.namespace || null;
        const needsUpdate = currentNamespace !== expectedNamespace && expectedNamespace !== null;

        log.debug(`Analysis: current="${currentNamespace}", expected="${expectedNamespace}", needsUpdate=${needsUpdate}`);

        return {
            needsUpdate,
            currentNamespace,
            expectedNamespace,
            namespaceInfo
        };
    }

    /**
     * Gets all C# files in a directory recursively
     */
    static async getCSharpFilesInDirectory(dirPath: string): Promise<string[]> {
        const files: string[] = [];

        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    const subFiles = await this.getCSharpFilesInDirectory(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile() && entry.name.endsWith('.cs')) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            log.error(`Error reading directory ${dirPath}:`, error);
        }

        return files;
    }
}