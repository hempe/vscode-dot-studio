import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const env = {
    workspacePath: '',
    warnings: [] as string[],
};

jest.mock('vscode', () => ({
    workspace: {
        get workspaceFolders() { return [{ uri: { fsPath: env.workspacePath } }]; },
    },
    window: {
        showWarningMessage: async (message: string) => { env.warnings.push(message); },
    },
}), { virtual: true });

import { DebugConfigService } from '../../../services/debugConfigService';
import { parseJsonc } from '../../../core/jsonc';

describe('DebugConfigService.updateStartupConfiguration', () => {
    let launchJsonPath: string;
    let tasksJsonPath: string;
    let projectPath: string;

    beforeEach(() => {
        env.workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'debugconfig-'));
        env.warnings = [];
        fs.mkdirSync(path.join(env.workspacePath, '.vscode'));
        fs.mkdirSync(path.join(env.workspacePath, 'App'));
        projectPath = path.join(env.workspacePath, 'App', 'App.csproj');
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
        launchJsonPath = path.join(env.workspacePath, '.vscode', 'launch.json');
        tasksJsonPath = path.join(env.workspacePath, '.vscode', 'tasks.json');
    });

    afterEach(() => {
        fs.rmSync(env.workspacePath, { recursive: true, force: true });
    });

    it('keeps comments and other configurations in launch.json and tasks.json', async () => {
        fs.writeFileSync(launchJsonPath, `{
    // Use IntelliSense to learn about possible attributes.
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Attach", // attach to a running process
            "type": "coreclr",
            "request": "attach",
        },
    ]
}`);
        fs.writeFileSync(tasksJsonPath, `{
    "version": "2.0.0",
    "tasks": [
        // my build task
        { "label": "build", "command": "dotnet", "args": ["build"] }
    ]
}`);

        await DebugConfigService.updateStartupConfiguration(projectPath);

        const launchText = fs.readFileSync(launchJsonPath, 'utf8');
        expect(launchText).toContain('// Use IntelliSense to learn about possible attributes.');
        expect(launchText).toContain('// attach to a running process');
        const configs = parseJsonc(launchText).value.configurations;
        expect(configs.map((c: any) => c.name)).toEqual(['Startup', 'Attach']);
        expect(configs[0].program).toBe('${workspaceFolder}/App/bin/Debug/net10.0/App.dll');

        const tasksText = fs.readFileSync(tasksJsonPath, 'utf8');
        expect(tasksText).toContain('// my build task');
        expect(parseJsonc(tasksText).value.tasks.map((t: any) => t.label)).toEqual(['build', 'StartupPreBuild']);

        expect(fs.existsSync(`${launchJsonPath}.backup`)).toBe(false);
        expect(DebugConfigService.getStartupProjectFromLaunchJson()).toBe(projectPath);
        expect(DebugConfigService.getActiveFrameworkFromLaunchJson()).toBe('net10.0');
    });

    it('leaves a launch.json with syntax errors untouched and warns', async () => {
        const broken = '{ "configurations": [ { "name": "Attach" ';
        fs.writeFileSync(launchJsonPath, broken);

        await DebugConfigService.updateStartupConfiguration(projectPath);

        expect(fs.readFileSync(launchJsonPath, 'utf8')).toBe(broken);
        expect(env.warnings).toEqual([expect.stringContaining('launch.json has syntax errors')]);
    });

    it('creates launch.json and tasks.json when missing', async () => {
        await DebugConfigService.updateStartupConfiguration(projectPath);

        expect(parseJsonc(fs.readFileSync(launchJsonPath, 'utf8')).value.configurations.map((c: any) => c.name)).toEqual(['Startup']);
        expect(parseJsonc(fs.readFileSync(tasksJsonPath, 'utf8')).value.tasks.map((t: any) => t.label)).toEqual(['StartupPreBuild']);
    });

    it('keeps StartupPreBuild out of the build group so Ctrl+Shift+B builds the solution', async () => {
        await DebugConfigService.updateStartupConfiguration(projectPath);

        const [task] = parseJsonc(fs.readFileSync(tasksJsonPath, 'utf8')).value.tasks;
        expect(task.group).toBeUndefined();
    });

    it('does not rewrite files that are already up to date', async () => {
        await DebugConfigService.updateStartupConfiguration(projectPath);
        const before = fs.statSync(launchJsonPath).mtimeMs;
        fs.utimesSync(launchJsonPath, new Date(0), new Date(0));

        await DebugConfigService.updateStartupConfiguration(projectPath);

        expect(fs.statSync(launchJsonPath).mtimeMs).not.toBe(before);
        expect(fs.statSync(launchJsonPath).mtimeMs).toBe(0);
    });
});
