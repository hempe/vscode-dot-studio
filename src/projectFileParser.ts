import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { minimatch } from 'minimatch';
import { shouldSkipDirectory, isRelevantFileExtension, RELEVANT_FILE_EXTENSIONS } from './constants';

export interface ProjectFile {
    path: string;
    relativePath: string;
    isDirectory: boolean;
    itemType?: string; // Compile, Content, None, etc.
}

export interface Dependency {
    name: string;
    version?: string;
    type: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkAssembly';
    path?: string; // For ProjectReferences
}

export interface ProjectFileStructure {
    files: ProjectFile[];
    directories: Set<string>;
    dependencies: Dependency[];
}

export class ProjectFileParser {
    private fileCache = new Map<string, { files: string[]; timestamp: number }>();
    private cacheTimeout = 30000; // 30 seconds
    
    constructor(private workspaceRoot: string) {}

    async parseProjectFiles(projectPath: string): Promise<ProjectFileStructure> {
        try {
            const projectDir = path.dirname(projectPath);
            
            // Parse dependencies from project file
            const dependencies = await this.parseDependencies(projectPath);
            
            // Use file patterns based on our relevant extensions
            const commonPatterns = RELEVANT_FILE_EXTENSIONS.map(ext => `**/*${ext}`);
            
            const allFiles: string[] = [];
            
            // Check if project is within workspace
            const relativePath = path.relative(this.workspaceRoot, projectDir);
            const isWithinWorkspace = !relativePath.startsWith('..');
            
            if (isWithinWorkspace) {
                // Use VS Code's workspace search for projects within workspace
                for (const pattern of commonPatterns) {
                    const searchPattern = relativePath ? `${relativePath}/${pattern}` : pattern;
                    const excludePattern = `{${relativePath}/bin/**,${relativePath}/obj/**}`;
                    
                    try {
                        const uris = await vscode.workspace.findFiles(searchPattern, excludePattern);
                        allFiles.push(...uris.map(uri => uri.fsPath));
                    } catch (error) {
                        // Continue with other patterns even if one fails
                        console.log(`Pattern ${pattern} failed:`, error);
                    }
                }
            } else {
                // For projects outside workspace, use direct file system scanning
                const projectFiles = await this.getAllFiles(projectDir);
                const filteredByPattern = projectFiles.filter(file => {
                    const ext = path.extname(file);
                    return isRelevantFileExtension(ext);
                });
                allFiles.push(...filteredByPattern);
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
            console.error('Error parsing project file:', error);
            return { files: [], directories: new Set(), dependencies: [] };
        }
    }

    private async getAllFiles(dir: string, maxDepth: number = 5): Promise<string[]> {
        if (maxDepth <= 0) return [];
        
        const files: string[] = [];
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip common directories that shouldn't be included
                    if (!shouldSkipDirectory(entry.name)) {
                        const subFiles = await this.getAllFiles(fullPath, maxDepth - 1);
                        files.push(...subFiles);
                    }
                } else {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
        }
        
        return files;
    }

    private async getAllFilesCached(dir: string): Promise<string[]> {
        const now = Date.now();
        const cached = this.fileCache.get(dir);
        
        // Return cached result if still valid
        if (cached && (now - cached.timestamp) < this.cacheTimeout) {
            return cached.files;
        }
        
        // Get fresh file list
        const files = await this.getAllFiles(dir);
        
        // Cache the result
        this.fileCache.set(dir, { files, timestamp: now });
        
        return files;
    }

    private async getFilesUsingVSCode(projectDir: string): Promise<string[]> {
        try {
            const relativePath = path.relative(this.workspaceRoot, projectDir);
            const searchPattern = relativePath ? `${relativePath}/**/*` : '**/*';
            
            // Use VS Code's optimized file search
            const uris = await vscode.workspace.findFiles(
                searchPattern,
                `{${relativePath}/bin/**,${relativePath}/obj/**,${relativePath}/.git/**,${relativePath}/.vs/**,${relativePath}/.vscode/**,${relativePath}/node_modules/**,${relativePath}/packages/**,${relativePath}/.nuget/**,${relativePath}/TestResults/**}`
            );
            
            return uris.map(uri => uri.fsPath);
        } catch (error) {
            console.error('Error using VS Code file search, falling back:', error);
            // Fallback to manual scanning if VS Code search fails
            return this.getAllFiles(projectDir);
        }
    }

    public clearCache(): void {
        this.fileCache.clear();
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

    private processIncludeExcludePatterns(allFiles: string[], project: any, projectDir: string): Map<string, string> {
        // Map of file path -> item type (Compile, Content, etc.)
        const result = new Map<string, string>();
        
        // First, add all files with default item types based on extension
        for (const filePath of allFiles) {
            const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/');
            const defaultItemType = this.getDefaultItemType(filePath);
            result.set(filePath, defaultItemType);
        }
        
        // Process ItemGroups
        if (project.ItemGroup) {
            for (const itemGroup of project.ItemGroup) {
                // Process explicit includes first
                this.processExplicitIncludes(itemGroup, result, projectDir);
                
                // Then process removes
                this.processRemoves(itemGroup, result, projectDir);
            }
        }
        
        return result;
    }

    private processExplicitIncludes(itemGroup: any, result: Map<string, string>, projectDir: string): void {
        const includeTypes = ['Compile', 'Content', 'EmbeddedResource', 'None', 'Reference', 'ProjectReference', 'PackageReference'];
        
        for (const includeType of includeTypes) {
            if (itemGroup[includeType]) {
                const items = Array.isArray(itemGroup[includeType]) ? itemGroup[includeType] : [itemGroup[includeType]];
                
                for (const item of items) {
                    if (item.$ && item.$.Include) {
                        const includePattern = item.$.Include;
                        
                        // Handle glob patterns
                        if (includePattern.includes('*') || includePattern.includes('?')) {
                            this.processGlobPattern(includePattern, result, projectDir, includeType);
                        } else {
                            // Direct file reference - add it even if it doesn't exist yet
                            // This handles cases where files are referenced but not yet created
                            const absolutePath = path.resolve(projectDir, includePattern);
                            result.set(absolutePath, includeType);
                        }
                    }
                }
            }
        }
    }

    private processRemoves(itemGroup: any, result: Map<string, string>, projectDir: string): void {
        const removeTypes = ['Compile', 'Content', 'EmbeddedResource', 'None'];
        
        for (const removeType of removeTypes) {
            if (itemGroup[removeType]) {
                const items = Array.isArray(itemGroup[removeType]) ? itemGroup[removeType] : [itemGroup[removeType]];
                
                for (const item of items) {
                    if (item.$ && item.$.Remove) {
                        const removePattern = item.$.Remove;
                        
                        // Remove matching files
                        for (const [filePath] of result) {
                            const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/');
                            if (minimatch(relativePath, removePattern)) {
                                result.delete(filePath);
                            }
                        }
                    }
                }
            }
        }
    }

    private processGlobPattern(pattern: string, result: Map<string, string>, projectDir: string, itemType: string): void {
        for (const [filePath] of result) {
            const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/');
            if (minimatch(relativePath, pattern)) {
                result.set(filePath, itemType);
            }
        }
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
                            const projectName = path.basename(proj.$.Include, path.extname(proj.$.Include));
                            dependencies.push({
                                name: projectName,
                                type: 'ProjectReference',
                                path: proj.$.Include
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
                            
                            // Distinguish between Framework assemblies and regular references
                            const isFrameworkAssembly = this.isFrameworkAssembly(refName);
                            
                            dependencies.push({
                                name: refName,
                                type: isFrameworkAssembly ? 'FrameworkAssembly' : 'Reference',
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
                        'FrameworkAssembly': 3, 
                        'Reference': 4 
                    };
                    return typeOrder[a.type] - typeOrder[b.type];
                }
                return a.name.localeCompare(b.name);
            });

        } catch (error) {
            console.error('Error parsing dependencies from project file:', error);
            return [];
        }
    }

    private isFrameworkAssembly(assemblyName: string): boolean {
        // Common .NET Framework assemblies
        const frameworkAssemblies = [
            'System', 'System.Core', 'System.Data', 'System.Drawing', 'System.Web',
            'System.Windows.Forms', 'System.Xml', 'System.Configuration',
            'System.ServiceModel', 'System.Runtime.Serialization', 'System.Transactions',
            'System.EnterpriseServices', 'System.Security', 'System.DirectoryServices',
            'System.Management', 'System.Net.Http', 'System.ComponentModel.DataAnnotations',
            'System.Web.Http', 'System.Web.Mvc', 'System.Data.Entity',
            'Microsoft.CSharp', 'Microsoft.VisualBasic', 'WindowsBase', 'PresentationCore',
            'PresentationFramework', 'System.Xaml', 'System.Activities',
            'System.ServiceProcess', 'System.Messaging', 'System.Runtime.Caching',
            'System.Web.Extensions', 'System.IdentityModel', 'System.Runtime.DurableInstancing',
            'System.Workflow.Activities', 'System.Workflow.ComponentModel', 
            'System.Workflow.Runtime', 'System.Net', 'System.Numerics'
        ];
        
        return frameworkAssemblies.some(framework => 
            assemblyName === framework || assemblyName.startsWith(framework + '.')
        );
    }

    private extractVersionFromReference(fullReference: string): string | undefined {
        // Extract version from reference like "System.Core, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"
        const versionMatch = fullReference.match(/Version=([^,]+)/);
        return versionMatch ? versionMatch[1] : undefined;
    }
}