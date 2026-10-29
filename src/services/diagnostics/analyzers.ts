import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger';
import { platformProperty } from './configurationManager/configurationManager';

const execFileAsync = promisify(execFile);
const log = logger('Analyzers');

/** Build property that makes the compiler write the source generators' output to `CompilerGeneratedFilesOutputPath` */
export const EMIT_GENERATED_FILES = '-property:EmitCompilerGeneratedFiles=true';

export interface ProjectAnalyzers {
    /** Where the last build wrote the generated files, `obj/<configuration>/<framework>/generated` by default */
    readonly generatedDir: string | undefined;
    /** Names of the analyzer and source generator assemblies, sorted */
    readonly analyzers: string[];
}

export interface AnalyzerAssembly {
    readonly name: string;
    /** The last build wrote files of its generators */
    readonly hasGenerated: boolean;
}

/** Reads the output of `dotnet msbuild -getItem:Analyzer -getProperty:CompilerGeneratedFilesOutputPath` */
export function parseAnalyzerQuery(json: string, projectDir: string): ProjectAnalyzers {
    const { Properties, Items } = JSON.parse(json);
    const outputPath: string = Properties?.CompilerGeneratedFilesOutputPath ?? '';
    const analyzers = (Items?.Analyzer ?? []).map((item: { FullPath?: string; Identity: string }) =>
        path.basename(item.FullPath || item.Identity).replace(/\.dll$/i, ''));
    return {
        generatedDir: outputPath ? path.resolve(projectDir, outputPath) : undefined,
        analyzers: [...new Set<string>(analyzers)].sort((a, b) => a.localeCompare(b)),
    };
}

const subdirectories = (dir: string): string[] => {
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
        return [];
    }
};

/**
 * The analyzers of a project for Dependencies > Analyzers. Generators that MSBuild adds late (Razor) are
 * only known through their output, so the folders of the generated files count as analyzers too.
 */
export function analyzerAssemblies(analyzers: readonly string[], generatedDir: string | undefined): AnalyzerAssembly[] {
    const generated = new Set(generatedDir ? subdirectories(generatedDir) : []);
    return [...new Set([...analyzers, ...generated])]
        .sort((a, b) => a.localeCompare(b))
        .map(name => ({ name, hasGenerated: generated.has(name) }));
}

/** The source generators of an analyzer assembly that generated files in the last build (full type names) */
export function sourceGenerators(generatedDir: string, analyzer: string): string[] {
    return subdirectories(path.join(generatedDir, analyzer)).sort((a, b) => a.localeCompare(b));
}

/** The files a source generator wrote in the last build, sorted by name */
export function generatedFiles(generatedDir: string, analyzer: string, generator: string): string[] {
    const files: string[] = [];
    const collect = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                collect(entryPath);
            } else {
                files.push(entryPath);
            }
        }
    };
    collect(path.join(generatedDir, analyzer, generator));
    return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

const cache = new Map<string, { stamp: string; result: Promise<ProjectAnalyzers> }>();

/**
 * Asks MSBuild for the analyzers of a project and where its generated files go, for a configuration and
 * framework. Cached until the project file or its restore output (`project.assets.json`) changes.
 */
export function queryAnalyzers(projectPath: string, configuration: string, framework?: string, platform?: string): Promise<ProjectAnalyzers> {
    const projectDir = path.dirname(projectPath);
    const mtime = (file: string) => {
        try {
            return fs.statSync(file).mtimeMs;
        } catch {
            return 0;
        }
    };
    const key = `${projectPath}|${configuration}|${framework ?? ''}|${platform ?? ''}`;
    const stamp = `${mtime(projectPath)}|${mtime(path.join(projectDir, 'obj', 'project.assets.json'))}`;
    const cached = cache.get(key);
    if (cached?.stamp === stamp) {
        return cached.result;
    }

    const fallback: ProjectAnalyzers = {
        generatedDir: path.join(projectDir, 'obj', configuration, ...(framework ? [framework] : []), 'generated'),
        analyzers: [],
    };
    const result = execFileAsync('dotnet', [
        'msbuild', projectPath, '-nologo',
        // Analyzers of packages (also transitive ones), of the framework, and of projects referenced with
        // OutputItemType="Analyzer" (resolved without building them)
        '-target:ResolveLockFileAnalyzers;ResolveTargetingPackAssets;ResolveProjectReferences',
        '-property:BuildProjectReferences=false',
        '-getItem:Analyzer', '-getProperty:CompilerGeneratedFilesOutputPath',
        EMIT_GENERATED_FILES,
        `-property:Configuration=${configuration}`,
        ...platformProperty(platform),
        ...(framework ? [`-property:TargetFramework=${framework}`] : []),
    ], { cwd: projectDir, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
        .then(({ stdout }) => parseAnalyzerQuery(stdout, projectDir))
        .catch(error => {
            log.warn(`Could not ask MSBuild for the analyzers of ${projectPath} (not restored yet?):`, error);
            cache.delete(key);
            return fallback;
        });
    cache.set(key, { stamp, result });
    return result;
}
