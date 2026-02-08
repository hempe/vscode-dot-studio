import * as path from 'path';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import { isSystemPath } from '../core/constants';
import { logger } from '../core/logger';
import {
    SolutionFile,
    SolutionProject,
    ProjectSection,
    GlobalSection,
    PROJECT_TYPE_GUIDS
} from '../types/solution';

const log = logger('FileSystemUtils');

export class SolutionFileParser {

    public static async parse(content: string, solutionDir: string): Promise<SolutionFile> {
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        const solution: SolutionFile = {
            formatVersion: '',
            projects: [],
            globalSections: [],
            nestedProjects: []
        };

        let i = 0;

        // Parse header
        while (i < lines.length) {
            const line = lines[i];

            if (line.startsWith('Microsoft Visual Studio Solution File')) {
                const formatMatch = line.match(/Format Version (\d+\.\d+)/);
                if (formatMatch) {
                    solution.formatVersion = formatMatch[1];
                }
            } else if (line.startsWith('VisualStudioVersion')) {
                const versionMatch = line.match(/VisualStudioVersion = (.+)/);
                if (versionMatch) {
                    solution.visualStudioVersion = versionMatch[1];
                }
            } else if (line.startsWith('MinimumVisualStudioVersion')) {
                const minVersionMatch = line.match(/MinimumVisualStudioVersion = (.+)/);
                if (minVersionMatch) {
                    solution.minimumVisualStudioVersion = minVersionMatch[1];
                }
            } else if (line.startsWith('Project(')) {
                // Start parsing projects
                break;
            }
            i++;
        }

        // Parse projects
        while (i < lines.length && lines[i].startsWith('Project(')) {
            const projectResult = this.parseProject(lines, i, solutionDir);
            solution.projects.push(projectResult.project);
            i = projectResult.nextIndex;
        }

        // Parse global sections
        while (i < lines.length) {
            const line = lines[i];

            if (line.startsWith('Global')) {
                i++; // Skip "Global"

                while (i < lines.length && !lines[i].startsWith('EndGlobal')) {
                    if (lines[i].startsWith('GlobalSection(')) {
                        const sectionResult = this.parseGlobalSection(lines, i);
                        solution.globalSections.push(sectionResult.section);

                        // Special handling for NestedProjects
                        if (sectionResult.section.name === 'NestedProjects') {
                            for (const [childGuid, parentGuid] of Object.entries(sectionResult.section.items)) {
                                solution.nestedProjects.push({
                                    childGuid: childGuid.trim(),
                                    parentGuid: parentGuid.trim()
                                });
                            }
                        }

                        i = sectionResult.nextIndex;
                    } else {
                        i++;
                    }
                }

                if (i < lines.length && lines[i].startsWith('EndGlobal')) {
                    i++;
                }
            } else {
                i++;
            }
        }

        // Enhance projects with framework information
        await this.enhanceProjectsWithFrameworks(solution, solutionDir);

        return solution;
    }

    /**
     * Enhance projects with framework information by parsing their project files
     */
    private static async enhanceProjectsWithFrameworks(solution: SolutionFile, solutionDir: string): Promise<void> {
        const parser = new xml2js.Parser();

        for (const project of solution.projects) {
            if (!this.isDotNetProject(project)) {
                continue;
            }

            try {
                // CRITICAL: Normalize and validate before resolving paths
                let projectPath = project.path;

                // Remove erroneous leading slash
                if (projectPath.startsWith('/') && !projectPath.startsWith('//')) {
                    log.info(`Framework enhancement - removing erroneous leading slash from: ${projectPath}`);
                    projectPath = projectPath.substring(1);
                }

                // Normalize path separators
                projectPath = projectPath.replace(/\\/g, path.sep).replace(/\//g, path.sep);

                // Check for system paths before resolving
                if (isSystemPath(projectPath)) {
                    log.error(`BLOCKED: Framework enhancement - project path is system path: ${projectPath}`);
                    continue;
                }

                const fullProjectPath = path.resolve(solutionDir, projectPath);

                // Double-check resolved path
                if (isSystemPath(fullProjectPath)) {
                    log.error(`BLOCKED: Framework enhancement - resolved path is system path: ${fullProjectPath}`);
                    continue;
                }

                const projectContent = await fs.promises.readFile(fullProjectPath, 'utf8');
                const projectData = await parser.parseStringPromise(projectContent);

                const frameworks: string[] = [];

                if (projectData?.Project?.PropertyGroup) {
                    for (const group of projectData.Project.PropertyGroup) {
                        // Check for TargetFrameworks (plural) first
                        if (group.TargetFrameworks) {
                            const frameworksValue = Array.isArray(group.TargetFrameworks) ? group.TargetFrameworks[0] : group.TargetFrameworks;
                            const multiple = frameworksValue.split(';')
                                .map((f: string) => f.trim())
                                .filter((f: string) => f);
                            frameworks.push(...multiple);
                        }
                        // Then check for TargetFramework (singular)
                        else if (group.TargetFramework) {
                            const frameworkValue = Array.isArray(group.TargetFramework) ? group.TargetFramework[0] : group.TargetFramework;
                            frameworks.push(frameworkValue.trim());
                        }
                    }
                }

                project.targetFrameworks = frameworks.length > 0 ? frameworks : undefined;
            } catch (error) {
                // Skip projects that can't be parsed
                project.targetFrameworks = undefined;
            }
        }
    }

    private static parseProject(lines: string[], startIndex: number, solutionDir: string): { project: SolutionProject; nextIndex: number } {
        const projectLine = lines[startIndex];
        const projectMatch = projectLine.match(/Project\("([^"]+)"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);

        if (!projectMatch) {
            throw new Error(`Invalid project line: ${projectLine}`);
        }

        const [, typeGuid, name, projectPathRaw, guid] = projectMatch;

        // CRITICAL: Normalize and validate project path
        log.info(`Parsing project: ${name} with raw path: "${projectPathRaw}"`);
        log.info(`Raw path length: ${projectPathRaw.length}, first char code: ${projectPathRaw.charCodeAt(0)}`);

        // Fix common path issues from solution files
        let projectPath = projectPathRaw;

        // Solution files should contain relative paths, not absolute paths
        // If we see a leading slash, it might be an error in parsing or file format
        if (projectPath.startsWith('/') && !projectPath.startsWith('//')) {
            log.warn(`WARNING: Project path starts with '/': "${projectPath}"`);
            log.warn(`This suggests an issue with solution file parsing or format`);

            // Only remove if it looks like an erroneous absolute path that should be relative
            if (!projectPath.startsWith('/home/') && !projectPath.startsWith('/usr/') && !projectPath.startsWith('/opt/')) {
                log.info(`Removing likely erroneous leading slash from: ${projectPath}`);
                projectPath = projectPath.substring(1);
            } else {
                log.error(`UNEXPECTED: Project path appears to be a real absolute path: ${projectPath}`);
                log.error(`Solution files should not contain absolute paths!`);
            }
        }

        // Normalize path separators to current platform
        projectPath = projectPath.replace(/\\/g, path.sep).replace(/\//g, path.sep);

        log.info(`Normalized project path: ${projectPath}`);

        // Check for obviously bad paths AFTER normalization
        if (isSystemPath(projectPath)) {
            log.error(`BLOCKED: Normalized project path is a system path: ${projectPath}`);
            throw new Error(`Invalid project path: ${projectPath} (system path)`);
        }

        // Check for absolute paths that might be problematic
        if (path.isAbsolute(projectPath)) {
            // Only allow absolute paths that are within the solution directory
            const normalizedSolutionDir = path.normalize(solutionDir);
            const normalizedProjectPath = path.normalize(projectPath);

            if (!normalizedProjectPath.startsWith(normalizedSolutionDir)) {
                log.error(`BLOCKED: Absolute project path outside solution directory: ${projectPath}`);
                throw new Error(`Invalid project path: ${projectPath} (absolute path outside solution)`);
            }
        }

        // Resolve and validate the full path
        let fullProjectPath;
        try {
            fullProjectPath = path.resolve(solutionDir, projectPath);
        } catch (error) {
            log.error(`BLOCKED: Failed to resolve project path: ${projectPath}`, error);
            throw new Error(`Cannot resolve project path: ${projectPath}`);
        }

        if (isSystemPath(fullProjectPath)) {
            log.error(`BLOCKED: Resolved project path is a system path: ${fullProjectPath}`);
            throw new Error(`Invalid resolved project path: ${fullProjectPath} (system path)`);
        }

        log.info(`Project ${name} resolved to: ${fullProjectPath}`);

        const project: SolutionProject = {
            typeGuid,
            name,
            path: typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER ? name : projectPath,  // Keep relative path for now
            guid,
            projectSections: []
        };

        let i = startIndex + 1;

        // Parse project sections and dependencies
        while (i < lines.length && !lines[i].startsWith('EndProject')) {
            const line = lines[i];

            if (line.startsWith('ProjectSection(')) {
                const sectionResult = this.parseProjectSection(lines, i);
                project.projectSections!.push(sectionResult.section);
                i = sectionResult.nextIndex;
            } else if (line.includes('ProjectDependencies')) {
                // Handle project dependencies if needed
                i++;
            } else {
                i++;
            }
        }

        if (i < lines.length && lines[i].startsWith('EndProject')) {
            i++;
        }

        return { project, nextIndex: i };
    }

    private static parseProjectSection(lines: string[], startIndex: number): { section: ProjectSection; nextIndex: number } {
        const sectionLine = lines[startIndex];
        const sectionMatch = sectionLine.match(/ProjectSection\(([^)]+)\)\s*=\s*(preProject|postProject)/);

        if (!sectionMatch) {
            throw new Error(`Invalid project section line: ${sectionLine}`);
        }

        const [, name, type] = sectionMatch;
        const section: ProjectSection = {
            name,
            type: type as 'preProject' | 'postProject',
            items: {}
        };

        let i = startIndex + 1;

        while (i < lines.length && !lines[i].startsWith('EndProjectSection')) {
            const line = lines[i].trim();
            if (line.includes('=')) {
                const [key, value] = line.split('=').map(s => s.trim());
                section.items[key] = value;
            }
            i++;
        }

        if (i < lines.length && lines[i].startsWith('EndProjectSection')) {
            i++;
        }

        return { section, nextIndex: i };
    }

    private static parseGlobalSection(lines: string[], startIndex: number): { section: GlobalSection; nextIndex: number } {
        const sectionLine = lines[startIndex];
        const sectionMatch = sectionLine.match(/GlobalSection\(([^)]+)\)\s*=\s*(preSolution|postSolution)/);

        if (!sectionMatch) {
            throw new Error(`Invalid global section line: ${sectionLine}`);
        }

        const [, name, type] = sectionMatch;
        const section: GlobalSection = {
            name,
            type: type as 'preSolution' | 'postSolution',
            items: {}
        };

        let i = startIndex + 1;

        while (i < lines.length && !lines[i].startsWith('EndGlobalSection')) {
            const line = lines[i].trim();
            if (line.includes('=')) {
                const [key, value] = line.split('=').map(s => s.trim());
                section.items[key] = value;
            }
            i++;
        }

        if (i < lines.length && lines[i].startsWith('EndGlobalSection')) {
            i++;
        }

        return { section, nextIndex: i };
    }

    // Utility methods
    public static isSolutionFolder(project: SolutionProject): boolean {
        return project.typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;
    }

    public static isDotNetProject(project: SolutionProject): boolean {
        return project.path.match(/\.(csproj|vbproj|fsproj)$/) !== null;
    }

    public static getSolutionItems(project: SolutionProject): string[] {
        if (!this.isSolutionFolder(project)) {
            return [];
        }

        const solutionItemsSection = project.projectSections?.find(s => s.name === 'SolutionItems');
        if (!solutionItemsSection) {
            return [];
        }

        return Object.keys(solutionItemsSection.items);
    }

    public static buildProjectHierarchy(solution: SolutionFile): Map<string, SolutionProject[]> {
        const hierarchy = new Map<string, SolutionProject[]>();
        const projectMap = new Map<string, SolutionProject>();

        // Create project lookup
        for (const project of solution.projects) {
            projectMap.set(project.guid, project);
        }

        // Initialize root level
        hierarchy.set('ROOT', []);

        // Build hierarchy based on nested projects
        for (const nested of solution.nestedProjects) {
            const childProject = projectMap.get(nested.childGuid);
            if (!childProject) continue;

            if (!hierarchy.has(nested.parentGuid)) {
                hierarchy.set(nested.parentGuid, []);
            }

            hierarchy.get(nested.parentGuid)!.push(childProject);
        }

        // Add projects that aren't nested to root
        const nestedChildGuids = new Set(solution.nestedProjects.map(n => n.childGuid));
        for (const project of solution.projects) {
            if (!nestedChildGuids.has(project.guid)) {
                hierarchy.get('ROOT')!.push(project);
            }
        }

        return hierarchy;
    }
}