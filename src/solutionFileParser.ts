import * as path from 'path';

export interface SolutionFile {
    formatVersion: string;
    visualStudioVersion?: string;
    minimumVisualStudioVersion?: string;
    projects: SolutionProject[];
    globalSections: GlobalSection[];
    nestedProjects: NestedProject[];
}

export interface SolutionProject {
    typeGuid: string;
    name: string;
    path: string;  // For regular projects, this is the .csproj path; for solution folders, it's the same as name
    guid: string;
    projectSections?: ProjectSection[];
    dependencies?: string[];  // Project GUIDs this project depends on
}

export interface ProjectSection {
    name: string;
    type: 'preProject' | 'postProject';
    items: Record<string, string>;
}

export interface GlobalSection {
    name: string;
    type: 'preSolution' | 'postSolution';
    items: Record<string, string>;
}

export interface NestedProject {
    childGuid: string;
    parentGuid: string;
}

export class SolutionFileParser {
    private static readonly PROJECT_TYPE_GUIDS = {
        SOLUTION_FOLDER: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
        CSHARP_PROJECT: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
        VB_PROJECT: '{F184B08F-C81C-45F6-A57F-5ABD9991F28F}',
        FSHARP_PROJECT: '{F2A71F9B-5D33-465A-A702-920D77279786}',
        CPP_PROJECT: '{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}',
        WEB_PROJECT: '{E24C65DC-7377-472B-9ABA-BC803B73C61A}',
        DATABASE_PROJECT: '{00D1A9C2-B5F0-4AF3-8072-F6C62B433612}'
    };

    public static parse(content: string, solutionDir: string): SolutionFile {
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

        return solution;
    }

    private static parseProject(lines: string[], startIndex: number, solutionDir: string): { project: SolutionProject; nextIndex: number } {
        const projectLine = lines[startIndex];
        const projectMatch = projectLine.match(/Project\("([^"]+)"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);
        
        if (!projectMatch) {
            throw new Error(`Invalid project line: ${projectLine}`);
        }

        const [, typeGuid, name, projectPath, guid] = projectMatch;
        
        const project: SolutionProject = {
            typeGuid,
            name,
            path: typeGuid === this.PROJECT_TYPE_GUIDS.SOLUTION_FOLDER ? name : path.resolve(solutionDir, projectPath.replace(/\\/g, '/')),
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
        return project.typeGuid === this.PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;
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