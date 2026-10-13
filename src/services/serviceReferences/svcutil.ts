import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

/** dotnet-svcutil 8 targets .NET 9; roll forward so it runs on newer runtimes */
export const SVCUTIL_ENV = { DOTNET_ROLL_FORWARD: 'Major', DOTNET_SVCUTIL_TELEMETRY_OPTOUT: '1' };

export type SvcutilInstall = 'local' | 'global';

export interface ProcessResult {
    readonly code: number;
    readonly output: string;
}

/** Runs a process, collecting stdout and stderr; never rejects */
export function run(file: string, args: string[], cwd: string, env: Record<string, string> = {}): Promise<ProcessResult> {
    return new Promise(resolve => {
        execFile(file, args, { cwd, env: { ...process.env, ...env }, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0;
            resolve({ code, output: `${stdout}${stderr}${error && !stdout && !stderr ? error.message : ''}` });
        });
    });
}

export function listsSvcutil(toolListOutput: string): boolean {
    return /^dotnet-svcutil\s/im.test(toolListOutput);
}

function globalToolPath(): string {
    return path.join(os.homedir(), '.dotnet', 'tools', process.platform === 'win32' ? 'dotnet-svcutil.exe' : 'dotnet-svcutil');
}

/** The local tool manifest (found from `cwd` upwards) wins over a global install */
export async function findSvcutil(cwd: string): Promise<SvcutilInstall | undefined> {
    if (listsSvcutil((await run('dotnet', ['tool', 'list'], cwd)).output)) {
        return 'local';
    }
    return fs.existsSync(globalToolPath()) ? 'global' : undefined;
}

export function svcutilCommand(install: SvcutilInstall, args: string[]): { file: string; args: string[] } {
    return install === 'local'
        ? { file: 'dotnet', args: ['tool', 'run', 'dotnet-svcutil', '--', ...args] }
        : { file: globalToolPath(), args };
}

export function runSvcutil(install: SvcutilInstall, args: string[], cwd: string): Promise<ProcessResult> {
    const command = svcutilCommand(install, args);
    return run(command.file, command.args, cwd, SVCUTIL_ENV);
}

/** Installs into the repository's tool manifest (created when missing) or globally */
export async function installSvcutil(install: SvcutilInstall, workspaceDir: string): Promise<ProcessResult> {
    if (install === 'global') {
        return run('dotnet', ['tool', 'install', '--global', 'dotnet-svcutil'], workspaceDir);
    }
    if (!fs.existsSync(path.join(workspaceDir, '.config', 'dotnet-tools.json')) && !fs.existsSync(path.join(workspaceDir, 'dotnet-tools.json'))) {
        const created = await run('dotnet', ['new', 'tool-manifest'], workspaceDir);
        if (created.code !== 0) {
            return created;
        }
    }
    return run('dotnet', ['tool', 'install', 'dotnet-svcutil'], workspaceDir);
}
