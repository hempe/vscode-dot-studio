import * as crypto from 'crypto';
import * as xml2js from 'xml2js';
import { SolutionFile, SolutionProject, PROJECT_TYPE_GUIDS } from '../types/solution';
import { logger } from '../core/logger';

const log = logger('SolutionXFileParser');

/** Errors for files that `dotnet` would refuse to load */
function invalid(reason: string): Error {
    return new Error(`Invalid .slnx file: ${reason}`);
}

/**
 * Parser for .slnx (XML-based) solution files
 *
 * The .slnx format is a modern XML-based solution format introduced by Microsoft
 * for better source control integration and easier parsing.
 *
 * Folders are flat; the hierarchy is encoded in the folder Name as a path.
 * Projects and files belong to the folder that contains them. Ids are optional.
 *
 * Example .slnx structure:
 * <Solution>
 *   <Configurations>
 *     <BuildType Name="Debug" />
 *     <Platform Name="Any CPU" />
 *   </Configurations>
 *   <Folder Name="/Solution Items/">
 *     <File Path="README.md" />
 *   </Folder>
 *   <Folder Name="/src/" />
 *   <Folder Name="/src/libs/">
 *     <Project Path="src/Lib/Lib.csproj" />
 *   </Folder>
 *   <Project Path="App/App.csproj" />
 * </Solution>
 */
export class SolutionXFileParser {

    /**
     * Parses .slnx XML content into a SolutionFile object
     *
     * @param content - The XML content of the .slnx file
     * @returns A SolutionFile object compatible with .sln format
     */
    public static async parse(content: string): Promise<SolutionFile> {
        log.debug('Parsing .slnx XML content');

        let result: any;
        try {
            const parser = new xml2js.Parser({
                explicitArray: true,
                mergeAttrs: false
            });
            result = await parser.parseStringPromise(content);
        } catch (error) {
            throw invalid(error instanceof Error ? error.message : String(error));
        }

        if (!result || !('Solution' in result)) {
            throw invalid('missing <Solution> root element');
        }

        // Empty elements (<Solution />, <Solution></Solution>) are parsed as strings
        const solutionXml = typeof result.Solution === 'object' ? result.Solution : {};

        const solution: SolutionFile = {
            formatVersion: '1.0', // .slnx uses different versioning
            projects: [],
            globalSections: [],
            nestedProjects: []
        };

        // Folder path ("a/b") -> folder entry
        const folders = new Map<string, SolutionProject>();
        const declaredFolders = new Set<string>();
        const projectPaths = new Set<string>();

        const addProject = (projectXml: any, parent?: SolutionProject) => {
            const project = this.parseProject(projectXml);
            const key = project.path.toLowerCase();
            if (projectPaths.has(key)) {
                throw invalid(`Duplicate project '${projectXml.$.Path}'`);
            }
            projectPaths.add(key);
            solution.projects.push(project);
            if (parent) {
                solution.nestedProjects.push({ childGuid: project.guid, parentGuid: parent.guid });
            }
        };

        // Nested <Folder> elements are not part of the format; like dotnet, only top-level ones count
        for (const folderXml of solutionXml.Folder ?? []) {
            const name: string | undefined = folderXml.$?.Name;
            if (!name) {
                throw invalid("Missing 'Name' on <Folder>");
            }

            const segments = name.split('/').filter(s => s.length > 0);
            if (!name.startsWith('/') || !name.endsWith('/') || segments.length === 0) {
                throw invalid(`Solution folder name '${name}' must start and end with '/'`);
            }

            const key = segments.join('/').toLowerCase();
            if (declaredFolders.has(key)) {
                throw invalid(`Duplicate folder '${name}'`);
            }
            declaredFolders.add(key);

            const folder = this.ensureFolder(segments, folders, solution, folderXml.$.Id);

            const items: Record<string, string> = {};
            for (const fileXml of folderXml.File ?? []) {
                const filePath = fileXml.$?.Path;
                if (filePath) {
                    items[filePath] = filePath;
                }
            }
            if (Object.keys(items).length > 0) {
                folder.projectSections!.push({
                    name: 'SolutionItems',
                    type: 'preProject',
                    items
                });
            }

            for (const projectXml of folderXml.Project ?? []) {
                addProject(projectXml, folder);
            }
        }

        for (const projectXml of solutionXml.Project ?? []) {
            addProject(projectXml);
        }

        const configurations = this.parseConfigurations(solutionXml.Configurations?.[0]);
        if (configurations) {
            solution.globalSections.push({
                name: 'SolutionConfigurationPlatforms',
                type: 'preSolution',
                items: configurations
            });
        }

        log.info(`Parsed .slnx with ${solution.projects.length} projects and ${solution.nestedProjects.length} nested items`);

        return solution;
    }

    /**
     * Returns the folder for the given path, creating it and any missing ancestors
     */
    private static ensureFolder(
        segments: string[],
        folders: Map<string, SolutionProject>,
        solution: SolutionFile,
        id?: string
    ): SolutionProject {
        const key = segments.join('/');
        const existing = folders.get(key.toLowerCase());
        if (existing) {
            return existing;
        }

        const parent = segments.length > 1
            ? this.ensureFolder(segments.slice(0, -1), folders, solution)
            : undefined;

        const folderName = segments[segments.length - 1];
        const folder: SolutionProject = {
            typeGuid: PROJECT_TYPE_GUIDS.SOLUTION_FOLDER,
            name: folderName,
            path: folderName,
            guid: id || this.stableGuid(`folder:${key}`),
            projectSections: []
        };

        folders.set(key.toLowerCase(), folder);
        solution.projects.push(folder);
        if (parent) {
            solution.nestedProjects.push({ childGuid: folder.guid, parentGuid: parent.guid });
        }

        log.debug(`Parsed folder: ${key} (${folder.guid})`);
        return folder;
    }

    private static parseProject(projectXml: any): SolutionProject {
        const rawPath: string | undefined = projectXml.$?.Path;
        if (!rawPath) {
            throw invalid("Missing 'Path' on <Project>");
        }

        const projectPath = rawPath.replace(/\\/g, '/');

        let typeGuid: string = PROJECT_TYPE_GUIDS.CSHARP_PROJECT;
        if (/\.vbproj$/i.test(projectPath)) {
            typeGuid = PROJECT_TYPE_GUIDS.VB_PROJECT;
        } else if (/\.fsproj$/i.test(projectPath)) {
            typeGuid = PROJECT_TYPE_GUIDS.FSHARP_PROJECT;
        }

        const project: SolutionProject = {
            typeGuid,
            name: this.getProjectName(projectPath),
            path: projectPath,
            guid: projectXml.$.Id || this.stableGuid(`project:${projectPath.toLowerCase()}`)
        };

        log.debug(`Parsed project: ${project.name} (${project.guid})`);
        return project;
    }

    /**
     * Expands <Configurations> BuildType x Platform into "BuildType|Platform" entries
     */
    private static parseConfigurations(configurationsXml: any): Record<string, string> | undefined {
        const buildTypes: string[] = (configurationsXml?.BuildType ?? []).map((b: any) => b.$?.Name).filter(Boolean);
        if (buildTypes.length === 0) {
            return undefined;
        }

        const platforms: string[] = (configurationsXml?.Platform ?? []).map((p: any) => p.$?.Name).filter(Boolean);
        if (platforms.length === 0) {
            platforms.push('Any CPU');
        }

        const items: Record<string, string> = {};
        for (const buildType of buildTypes) {
            for (const platform of platforms) {
                const config = `${buildType}|${platform}`;
                items[config] = config;
            }
        }
        return items;
    }

    private static getProjectName(projectPath: string): string {
        const parts = projectPath.split(/[\/\\]/);
        const fileName = parts[parts.length - 1];
        return fileName.replace(/\.(csproj|vbproj|fsproj)$/i, '');
    }

    /**
     * .slnx files usually omit Ids, so derive a deterministic GUID from the item's identity
     * to keep node ids stable across re-parses.
     */
    private static stableGuid(key: string): string {
        const hex = crypto.createHash('md5').update(key).digest('hex').toUpperCase();
        return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
    }

    /**
     * Serializes a SolutionFile object to .slnx XML format
     *
     * @param solutionFile - The solution file object to serialize
     * @returns XML string in .slnx format
     */
    public static async serialize(solutionFile: SolutionFile): Promise<string> {
        try {
            log.debug('Serializing SolutionFile to .slnx XML');

            // TODO: Implement .slnx serialization
            // Convert SolutionFile structure to .slnx XML format

            const builder = new xml2js.Builder({
                rootName: 'Solution',
                xmldec: { version: '1.0', encoding: 'UTF-8' }
            });

            // For now, create minimal XML structure
            const xml = builder.buildObject({
                '@': {
                    Version: solutionFile.formatVersion || '1.0'
                }
                // TODO: Add Project, Folder, Configuration elements
            });

            log.warn('.slnx serialization not yet implemented');
            return xml;

        } catch (error) {
            log.error('Error serializing to .slnx:', error);
            throw new Error(`Failed to serialize .slnx file: ${error}`);
        }
    }

    // Utility methods (same as SolutionFileParser for consistency)

    public static isSolutionFolder(project: SolutionProject): boolean {
        return project.typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;
    }

    public static isDotNetProject(project: SolutionProject): boolean {
        return project.path.match(/\.(csproj|vbproj|fsproj)$/) !== null;
    }
}
