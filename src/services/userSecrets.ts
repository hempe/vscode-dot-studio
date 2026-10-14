import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProjectFileEditor } from '../parsers/projectFileEditor';
import { logger } from '../core/logger';

const execFileAsync = promisify(execFile);
const log = logger('UserSecrets');

/** Where ASP.NET Core's user secrets configuration reads a project's secrets.json */
export function userSecretsPath(id: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    return platform === 'win32'
        ? path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'UserSecrets', id, 'secrets.json')
        : path.join(env.HOME ?? os.homedir(), '.microsoft', 'usersecrets', id, 'secrets.json');
}

/** The UserSecretsId MSBuild evaluates, e.g. from Directory.Build.props */
async function evaluatedUserSecretsId(projectPath: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync('dotnet', ['msbuild', projectPath, '-nologo', '-getProperty:UserSecretsId'],
            { cwd: path.dirname(projectPath), timeout: 60000 });
        return stdout.trim() || undefined;
    } catch (error) {
        log.warn(`Could not evaluate the UserSecretsId of ${projectPath}:`, error);
        return undefined;
    }
}

/**
 * Visual Studio's "Manage User Secrets": opens the project's secrets.json, giving the project a
 * UserSecretsId and creating the file first when needed
 */
export async function manageUserSecrets(projectPath: string): Promise<void> {
    try {
        const content = await fs.promises.readFile(projectPath, 'utf8');
        let id = ProjectFileEditor.userSecretsId(content) ?? await evaluatedUserSecretsId(projectPath);
        if (!id) {
            id = randomUUID();
            await fs.promises.writeFile(projectPath, ProjectFileEditor.addUserSecretsId(content, id), 'utf8');
            log.info(`Added UserSecretsId ${id} to ${projectPath}`);
        }

        const secretsPath = userSecretsPath(id);
        if (!fs.existsSync(secretsPath)) {
            await fs.promises.mkdir(path.dirname(secretsPath), { recursive: true });
            await fs.promises.writeFile(secretsPath, '{\n}\n', 'utf8');
        }
        await vscode.window.showTextDocument(vscode.Uri.file(secretsPath));
    } catch (error) {
        log.error('Managing user secrets failed:', error);
        vscode.window.showErrorMessage(`Could not open the user secrets: ${error instanceof Error ? error.message : error}`);
    }
}
