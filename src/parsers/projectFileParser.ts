import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { excludePatterns, isSystemPath } from '../core/constants';
import { logger } from '../core/logger';

export interface ProjectFile {
    path: string;
    relativePath: string;
    isDirectory: boolean;
    itemType?: string; // Compile, Content, None, etc.
}

export interface Dependency {
    name: string;
    version?: string;
    type: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference';
    path?: string; // For ProjectReferences
}

export interface ProjectFileStructure {
    files: ProjectFile[];
    directories: Set<string>;
    dependencies: Dependency[];
}

const searchPattern = '**/*';  // everything under projectDir
const log = logger('ProjectFileParser');

export class ProjectFileParser {

    constructor(private workspaceRoot: string) { }

    async parseProjectFiles(projectPath: string): Promise<ProjectFileStructure> {
        try {
            // CRITICAL: Validate project path before any operations
            if (isSystemPath(projectPath)) {
                log.warn(`Blocked attempt to parse system path project: ${projectPath}`);
                return { files: [], directories: new Set(), dependencies: [] };
            }

            // Check if project file exists before proceeding
            try {
                await fs.promises.access(projectPath, fs.constants.F_OK);
            } catch (accessError) {
                log.warn(`Project file does not exist: ${projectPath}`);
                log.warn(`This project is referenced in solution but file is missing`);
                return { files: [], directories: new Set(), dependencies: [] };
            }

            const projectDir = path.dirname(projectPath);

            // CRITICAL: Validate project directory
            if (isSystemPath(projectDir)) {
                log.warn(`Blocked attempt to parse project in system directory: ${projectDir}`);
                return { files: [], directories: new Set(), dependencies: [] };
            }

            // Parse dependencies from project file
            const dependencies = await this.parseDependencies(projectPath);

            // Use file patterns based on our relevant extensions
            const pattern = `**/*.*`;
            const allFiles: string[] = [];

            // Check if project is within workspace
            const relativePath = path.relative(this.workspaceRoot, projectDir);

            if (isSystemPath(projectDir)) {
                log.warn(`Skipping system directory project: ${projectDir}`);

            } else {
                // Use glob search for projects within workspace                
                try {
                    const files = await glob(searchPattern, {
                        cwd: projectDir,
                        ignore: excludePatterns,
                        absolute: true,
                        dot: false
                    });

                    allFiles.push(...files);
                } catch (error) {
                    // Continue with other patterns even if one fails
                    log.error(`Pattern ${pattern} failed:`, error);
                }
            }

            // Remove duplicates and filter
            const uniqueFiles = [...new Set(allFiles)];
            const filteredFiles = uniqueFiles.filter(file => !this.shouldSkipFile(file, projectPath));

            // Build structure with dependencies
            const fileStructure = this.buildSimpleFileStructure(filteredFiles, projectDir);
            return {
                ...fileStructure,
                dependencies
            };

        } catch (error) {
            log.error('Error parsing project file:', error);
            return { files: [], directories: new Set(), dependencies: [] };
        }
    }

    // Remove this method since we now use the shared function from constants

    private shouldSkipFile(filePath: string, projectPath: string): boolean {
        // Skip the project file itself - it's the "node" that defines the tree
        if (filePath === projectPath) {
            return true;
        }

        // Skip other common files that shouldn't appear in project tree
        const fileName = path.basename(filePath);
        const skipFiles = ['.gitignore', '.gitattributes', 'Directory.Build.props', 'Directory.Build.targets'];

        return skipFiles.includes(fileName);
    }

    private getDefaultItemType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();

        switch (ext) {
            case '.cs':
            case '.vb':
            case '.fs':
                return 'Compile';
            case '.resx':
                return 'EmbeddedResource';
            case '.config':
            case '.json':
            case '.xml':
                return 'Content';
            default:
                return 'None';
        }
    }

    private buildFileStructure(includedFiles: Map<string, string>, projectDir: string): ProjectFileStructure {
        const files: ProjectFile[] = [];
        const directories = new Set<string>();

        for (const [filePath, itemType] of includedFiles) {
            const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/');

            files.push({
                path: filePath,
                relativePath,
                isDirectory: false,
                itemType
            });

            // Add parent directories
            const dirPath = path.dirname(relativePath);
            if (dirPath !== '.') {
                const parts = dirPath.split('/');
                let currentPath = '';

                for (const part of parts) {
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    directories.add(currentPath);
                }
            }
        }

        // Add directory entries
        for (const dir of directories) {
            files.push({
                path: path.resolve(projectDir, dir),
                relativePath: dir,
                isDirectory: true
            });
        }

        return { files, directories, dependencies: [] };
    }

    private buildSimpleFileStructure(files: string[], projectDir: string): ProjectFileStructure {
        const result: ProjectFile[] = [];
        const directories = new Set<string>();

        for (const filePath of files) {
            const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/');

            result.push({
                path: filePath,
                relativePath,
                isDirectory: false,
                itemType: this.getDefaultItemType(filePath)
            });

            // Add parent directories
            const dirPath = path.dirname(relativePath);
            if (dirPath !== '.') {
                const parts = dirPath.split('/');
                let currentPath = '';

                for (const part of parts) {
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    directories.add(currentPath);
                }
            }
        }

        // Add directory entries
        for (const dir of directories) {
            result.push({
                path: path.resolve(projectDir, dir),
                relativePath: dir,
                isDirectory: true
            });
        }

        return { files: result, directories, dependencies: [] };
    }

    private async parseDependencies(projectPath: string): Promise<Dependency[]> {
        try {
            // Validate path is not a system path (already resolved absolute path)
            if (isSystemPath(projectPath)) {
                log.error(`BLOCKED: parseDependencies - path is system path: ${projectPath}`);
                return [];
            }

            // log.log(`parseDependencies - reading project file: ${projectPath}`);

            // Check if file exists before trying to read it
            try {
                await fs.promises.access(projectPath, fs.constants.F_OK);
            } catch (accessError) {
                log.warn(`Project file does not exist: ${projectPath}`);
                log.warn(`This is likely a missing/deleted project referenced in the solution file`);
                return []; // Return empty dependencies for missing projects
            }

            const projectContent = await fs.promises.readFile(projectPath, 'utf8');
            const parsedXml = await parseStringPromise(projectContent);
            const project = parsedXml.Project;

            if (!project || !project.ItemGroup) {
                return [];
            }

            const dependencies: Dependency[] = [];

            for (const itemGroup of project.ItemGroup) {
                // Parse PackageReferences
                if (itemGroup.PackageReference) {
                    const packages = Array.isArray(itemGroup.PackageReference)
                        ? itemGroup.PackageReference
                        : [itemGroup.PackageReference];

                    for (const pkg of packages) {
                        if (pkg.$ && pkg.$.Include) {
                            dependencies.push({
                                name: pkg.$.Include,
                                version: pkg.$.Version,
                                type: 'PackageReference'
                            });
                        }
                    }
                }

                // Parse ProjectReferences
                if (itemGroup.ProjectReference) {
                    const projects = Array.isArray(itemGroup.ProjectReference)
                        ? itemGroup.ProjectReference
                        : [itemGroup.ProjectReference];

                    for (const proj of projects) {
                        if (proj.$ && proj.$.Include) {
                            // Normalize path separators first, then extract basename
                            const normalizedPath = proj.$.Include.replace(/\\/g, '/');
                            const projectName = path.basename(normalizedPath, path.extname(normalizedPath));
                            dependencies.push({
                                name: projectName,
                                type: 'ProjectReference',
                                path: proj.$.Include
                            });
                        }
                    }
                }

                // Parse FrameworkReferences (for .NET Core/5+ projects)
                if (itemGroup.FrameworkReference) {
                    const frameworkRefs = Array.isArray(itemGroup.FrameworkReference)
                        ? itemGroup.FrameworkReference
                        : [itemGroup.FrameworkReference];

                    for (const frameworkRef of frameworkRefs) {
                        if (frameworkRef.$ && frameworkRef.$.Include) {
                            dependencies.push({
                                name: frameworkRef.$.Include,
                                type: 'FrameworkReference'
                                // FrameworkReferences don't have versions as they use the runtime version
                            });
                        }
                    }
                }

                // Parse regular References (for .NET Framework projects)
                if (itemGroup.Reference) {
                    const references = Array.isArray(itemGroup.Reference)
                        ? itemGroup.Reference
                        : [itemGroup.Reference];

                    for (const ref of references) {
                        if (ref.$ && ref.$.Include) {
                            const fullName = ref.$.Include;
                            const refName = fullName.split(',')[0]; // Remove version info

                            dependencies.push({
                                name: refName,
                                type: 'Reference',
                                version: this.extractVersionFromReference(fullName)
                            });
                        }
                    }
                }
            }

            return dependencies.sort((a, b) => {
                // Sort by type first, then by name
                if (a.type !== b.type) {
                    const typeOrder = {
                        'PackageReference': 1,
                        'ProjectReference': 2,
                        'FrameworkReference': 3,
                        'Reference': 4
                    };
                    return typeOrder[a.type] - typeOrder[b.type];
                }
                return a.name.localeCompare(b.name);
            });

        } catch (error) {
            log.error('Error parsing dependencies from project file:', error);
            return [];
        }
    }
    private extractVersionFromReference(fullReference: string): string | undefined {
        // Extract version from reference like "System.Core, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"
        const versionMatch = fullReference.match(/Version=([^,]+)/);
        return versionMatch ? versionMatch[1] : undefined;
    }
}