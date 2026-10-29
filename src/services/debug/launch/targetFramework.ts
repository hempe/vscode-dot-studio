import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { parseStringPromise } from 'xml2js';
import { sortFrameworksByVersion } from '../frameworkOrder';
import { isNetFrameworkTarget } from '../../parsers/targetFrameworks';
import { platformProperty } from '../configurationManager/configurationManager';

const execFileAsync = promisify(execFile);

const log = logger('targetFramework');

/**
 * The assembly the project builds for a configuration and framework, as MSBuild evaluates it
 * (`TargetPath`): respects OutputPath, AssemblyName, the artifacts layout and Directory.Build.props.
 * Falls back to the default `bin/<configuration>/<framework>/<project>.dll` when evaluation fails.
 */
export async function resolveTargetPath(projectPath: string, configuration: string, framework: string | null, platform?: string): Promise<string> {
    const projectDir = path.dirname(projectPath);
    const fallback = path.join(projectDir, 'bin', configuration, framework || 'net*',
        `${path.basename(projectPath, path.extname(projectPath))}.${isNetFrameworkTarget(framework) ? 'exe' : 'dll'}`);
    try {
        const { stdout } = await execFileAsync('dotnet', [
            'msbuild', projectPath, '-nologo', '-getProperty:TargetPath',
            `-property:Configuration=${configuration}`,
            ...platformProperty(platform),
            ...(framework ? [`-property:TargetFramework=${framework}`] : []),
        ], { cwd: projectDir, timeout: 60000 });
        const targetPath = stdout.trim().split(/\r?\n/).pop()?.trim();
        if (targetPath && path.isAbsolute(targetPath)) {
            return targetPath;
        }
        log.warn(`MSBuild returned no TargetPath for ${projectPath}, using ${fallback}`);
    } catch (error) {
        log.warn(`Could not evaluate the output path of ${projectPath}, using ${fallback}:`, error);
    }
    return fallback;
}

/**
 * Determines the best target framework for the project
 */
export async function determineTargetFramework(projectPath: string, preferredFramework?: string): Promise<string | null> {
    try {
        // Parse the project file to get its target frameworks
        const frameworks = await extractTargetFrameworks(projectPath);

        if (!frameworks || frameworks.length === 0) {
            log.warn(`No target frameworks found in project: ${projectPath}`);
            return preferredFramework || null;
        }

        log.info(`Available frameworks in project: ${frameworks.join(', ')}`);

        // If a specific framework is preferred and it exists in the project, use it
        if (preferredFramework && preferredFramework !== 'auto' && frameworks.includes(preferredFramework)) {
            log.info(`Using preferred framework: ${preferredFramework}`);
            return preferredFramework;
        }

        // If preference is 'auto' or not specified, pick the highest version
        const sortedFrameworks = sortFrameworksByVersion(frameworks);
        const selectedFramework = sortedFrameworks[0]; // Highest version first

        log.info(`Auto-selected highest framework version: ${selectedFramework}`);
        return selectedFramework;
    } catch (error) {
        log.error('Error determining target framework:', error);
        return preferredFramework || null;
    }
}

/**
 * Extracts target frameworks from a project file
 */
export async function extractTargetFrameworks(projectPath: string): Promise<string[]> {
    try {
        if (!fs.existsSync(projectPath)) {
            log.warn(`Project file does not exist: ${projectPath}`);
            return [];
        }

        const projectXml = await fs.promises.readFile(projectPath, 'utf8');
        const parsed = await parseStringPromise(projectXml);

        const frameworks: string[] = [];

        // Navigate through PropertyGroups to find TargetFramework(s)
        if (parsed.Project && parsed.Project.PropertyGroup) {
            const propertyGroups = Array.isArray(parsed.Project.PropertyGroup)
                ? parsed.Project.PropertyGroup
                : [parsed.Project.PropertyGroup];

            for (const group of propertyGroups) {
                // Check for TargetFrameworks (plural) first
                if (group.TargetFrameworks) {
                    const frameworksValue = Array.isArray(group.TargetFrameworks)
                        ? group.TargetFrameworks[0]
                        : group.TargetFrameworks;
                    const multiple = frameworksValue.split(';')
                        .map((f: string) => f.trim())
                        .filter((f: string) => f);
                    frameworks.push(...multiple);
                }
                // Then check for TargetFramework (singular)
                else if (group.TargetFramework) {
                    const frameworkValue = Array.isArray(group.TargetFramework)
                        ? group.TargetFramework[0]
                        : group.TargetFramework;
                    frameworks.push(frameworkValue.trim());
                }
            }
        }

        return frameworks;
    } catch (error) {
        log.error(`Error extracting target frameworks from ${projectPath}:`, error);
        return [];
    }
}
