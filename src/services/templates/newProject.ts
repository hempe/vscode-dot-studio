import * as fs from 'fs';
import * as path from 'path';
import { VersionUtils } from '../versionUtils';

/**
 * Where a new project goes, relative to the solution directory: next to the other projects,
 * i.e. in the folder most project folders are in (`src/<name>`), else next to the solution.
 */
export function defaultProjectLocation(solutionDir: string, projectPaths: string[], name: string): string {
    const counts = new Map<string, number>();
    for (const projectPath of projectPaths) {
        const parent = path.relative(solutionDir, path.dirname(path.dirname(projectPath)));
        if (!parent.startsWith('..') && !path.isAbsolute(parent)) {
            counts.set(parent, (counts.get(parent) ?? 0) + 1);
        }
    }
    const [parent] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [''];
    return parent ? path.join(parent, name) : name;
}

/** The target framework most projects use; the newest on a tie */
export function mostCommonFramework(frameworksPerProject: string[][]): string | undefined {
    const counts = new Map<string, number>();
    frameworksPerProject.flat().forEach(framework => counts.set(framework, (counts.get(framework) ?? 0) + 1));
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || VersionUtils.compare(a[0].replace(/^\D+/, ''), b[0].replace(/^\D+/, '')))[0]?.[0];
}

export function isValidProjectName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name);
}

/** The choices of the `--framework` option in `dotnet new <template> -h` */
export function frameworkChoices(helpOutput: string): string[] {
    const lines = helpOutput.split(/\r?\n/);
    const option = lines.findIndex(line => /--framework\b/.test(line));
    if (option < 0) {
        return [];
    }
    const choices: string[] = [];
    for (const line of lines.slice(option + 1)) {
        if (/^\s*-{1,2}\w/.test(line) || /^\s*Default:/.test(line)) {
            break;
        }
        const choice = /^\s{4,}(net[\w.]+)\s/.exec(line);
        if (choice) {
            choices.push(choice[1]);
        }
    }
    return choices;
}

export function findProjectFile(dir: string): string | undefined {
    const file = fs.existsSync(dir) ? fs.readdirSync(dir).find(name => /\.(cs|fs|vb)proj$/i.test(name)) : undefined;
    return file ? path.join(dir, file) : undefined;
}
