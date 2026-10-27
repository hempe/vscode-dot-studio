import * as path from 'path';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { isSystemPath } from '../core/constants';
import { logger } from '../core/logger';

export interface Dependency {
    name: string;
    version?: string;
    type: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference';
    path?: string; // For ProjectReferences
}

const log = logger('ProjectFileParser');

/** Reads what a project file references: packages, projects, shared frameworks and assemblies */
export class ProjectFileParser {

    async parseDependencies(projectPath: string): Promise<Dependency[]> {
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