import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { minimatch } from 'minimatch';

export interface ProjectFile {
    path: string;
    relativePath: string;
    isDirectory: boolean;
    itemType?: string; // Compile, Content, None, etc.
}

export interface ProjectFileStructure {
    files: ProjectFile[];
    directories: Set<string>;
}

export class ProjectFileParser {
    constructor(private workspaceRoot: string) {}

    async parseProjectFiles(projectPath: string): Promise<ProjectFileStructure> {
        try {
            const projectContent = await fs.promises.readFile(projectPath, 'utf8');
            const projectDir = path.dirname(projectPath);
            
            // Parse the XML
            const parsedXml = await parseStringPromise(projectContent);
            const project = parsedXml.Project;
            
            if (!project) {
                return { files: [], directories: new Set() };
            }

            // Get all files in the project directory recursively
            const allFiles = await this.getAllFiles(projectDir);
            
            // Filter out the project file itself
            const filteredFiles = allFiles.filter(file => !this.shouldSkipFile(file, projectPath));
            
            // Process include/exclude patterns
            const includedFiles = this.processIncludeExcludePatterns(filteredFiles, project, projectDir);
            
            return this.buildFileStructure(includedFiles, projectDir);
            
        } catch (error) {
            console.error('Error parsing project file:', error);
            return { files: [], directories: new Set() };
        }
    }

    private async getAllFiles(dir: string): Promise<string[]> {
        const files: string[] = [];
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip common directories that shouldn't be included
                    if (!this.shouldSkipDirectory(entry.name)) {
                        const subFiles = await this.getAllFiles(fullPath);
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

    private shouldSkipDirectory(dirName: string): boolean {
        const skipDirs = ['bin', 'obj', 'node_modules', '.git', '.vs', '.vscode'];
        return skipDirs.includes(dirName);
    }

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
                            // Direct file reference
                            const absolutePath = path.resolve(projectDir, includePattern);
                            if (fs.existsSync(absolutePath)) {
                                result.set(absolutePath, includeType);
                            }
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
        
        return { files, directories };
    }
}