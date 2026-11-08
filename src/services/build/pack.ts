import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { activeProjectBuild } from './activeBuild';
import { platformProperty } from './configurationManager/configurationManager';
import { t } from '../../core/i18n';

const execFileAsync = promisify(execFile);
const log = logger('Pack');

/** When the last Pack of each project started, to tell the packages it wrote from older ones */
const startedAt = new Map<string, number>();

export function packStarted(projectPath: string): void {
    startedAt.set(projectPath, Date.now());
}

/** The packages (`.nupkg`, `.snupkg`) in a folder written at or after `since`, newest first */
export function packagesWrittenSince(dir: string, since: number): string[] {
    let names: string[];
    try {
        names = fs.readdirSync(dir).filter(name => /\.s?nupkg$/i.test(name));
    } catch {
        return [];
    }
    return names
        .map(name => ({ file: path.join(dir, name), time: fs.statSync(path.join(dir, name)).mtimeMs }))
        .filter(({ time }) => time >= since)
        .sort((a, b) => b.time - a.time)
        .map(({ file }) => file);
}

/** Where `dotnet pack` puts the packages of the project (its PackageOutputPath) */
async function packageOutputDirectory(projectPath: string, configuration: string, platform?: string): Promise<string> {
    const projectDir = path.dirname(projectPath);
    try {
        const { stdout } = await execFileAsync('dotnet', [
            'msbuild', projectPath, '-nologo', '-getProperty:PackageOutputPath', `-property:Configuration=${configuration}`, ...platformProperty(platform),
        ], { cwd: projectDir, timeout: 60000 });
        const dir = (JSON.parse(stdout) as { Properties?: { PackageOutputPath?: string } }).Properties?.PackageOutputPath;
        if (dir) {
            return path.resolve(projectDir, dir);
        }
    } catch (error) {
        log.warn(`Could not read PackageOutputPath of ${projectPath}:`, error);
    }
    return path.join(projectDir, 'bin', configuration);
}

/** After a successful `dotnet pack` task: tells where the package went, or why there is none */
export async function reportPacked(projectPath: string): Promise<void> {
    const projectName = path.basename(projectPath, path.extname(projectPath));
    const since = (startedAt.get(projectPath) ?? Date.now()) - 1000;
    const { configuration, platform } = activeProjectBuild(projectPath);
    const dir = await packageOutputDirectory(projectPath, configuration, platform);
    const packages = packagesWrittenSince(dir, since);
    if (packages.length === 0) {
        vscode.window.showWarningMessage(t('Pack {0} wrote no package to {1}. Is the project packable (<IsPackable>false</IsPackable>)?', projectName, dir));
        return;
    }
    const [main] = packages;
    const reveal = t('Reveal in Explorer');
    const copy = t('Copy Path');
    const choice = await vscode.window.showInformationMessage(t('Packed {0} into {1}', path.basename(main), dir), reveal, copy);
    if (choice === reveal) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(main));
    } else if (choice === copy) {
        await vscode.env.clipboard.writeText(main);
    }
}
