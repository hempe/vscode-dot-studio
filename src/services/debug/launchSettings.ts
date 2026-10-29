import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isWebProject } from '../parsers/projectKind';
import { logger } from '../core/logger';

const log = logger('LaunchSettings');

/** A port in [from, from + 300), the ranges `dotnet new` picks from */
const randomPort = (from: number) => from + Math.floor(Math.random() * 300);

/**
 * The launchSettings.json `dotnet new` writes: `http` and `https` profiles for web projects, one profile named after the
 * project for the others (like the worker template)
 */
export function defaultLaunchSettings(projectName: string, web: boolean, ports = { http: randomPort(5000), https: randomPort(7000) }): string {
    const profiles = web
        ? {
            http: {
                commandName: 'Project',
                dotnetRunMessages: true,
                launchBrowser: true,
                applicationUrl: `http://localhost:${ports.http}`,
                environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
            },
            https: {
                commandName: 'Project',
                dotnetRunMessages: true,
                launchBrowser: true,
                applicationUrl: `https://localhost:${ports.https};http://localhost:${ports.http}`,
                environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
            },
        }
        : {
            [projectName]: {
                commandName: 'Project',
                dotnetRunMessages: true,
                environmentVariables: { DOTNET_ENVIRONMENT: 'Development' },
            },
        };
    return JSON.stringify({ $schema: 'https://json.schemastore.org/launchsettings.json', profiles }, null, 2) + '\n';
}

/** The project's Properties/launchSettings.json, created with the default profiles when it doesn't exist */
export async function ensureLaunchSettings(projectPath: string): Promise<string> {
    const file = path.join(path.dirname(projectPath), 'Properties', 'launchSettings.json');
    if (!fs.existsSync(file)) {
        const projectXml = await fs.promises.readFile(projectPath, 'utf8');
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, defaultLaunchSettings(path.basename(projectPath, path.extname(projectPath)), isWebProject(projectXml)), 'utf8');
        log.info(`Created ${file}`);
    }
    return file;
}

/** "Open Launch Settings" on a project that can be started */
export async function openLaunchSettings(projectPath: string): Promise<void> {
    try {
        await vscode.window.showTextDocument(vscode.Uri.file(await ensureLaunchSettings(projectPath)));
    } catch (error) {
        log.error('Opening the launch settings failed:', error);
        vscode.window.showErrorMessage(`Could not open the launch settings: ${error instanceof Error ? error.message : error}`);
    }
}
