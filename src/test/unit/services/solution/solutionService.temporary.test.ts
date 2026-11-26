// Temporary solutions: opened from projects without a solution, saved with dotnet where the user wants (runs the .NET SDK)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    button: undefined as string | undefined,
    saveTo: undefined as string | undefined,
    asked: [] as string[],
    errors: [] as string[],
    inputBox: undefined as string | undefined,
};

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        commands: { executeCommand: async () => undefined },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        window: {
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
            showInputBox: async () => ui.inputBox,
            showInformationMessage: async () => undefined,
            showWarningMessage: async (message: string) => { ui.asked.push(message); return ui.button; },
            showSaveDialog: async () => ui.saveTo ? { fsPath: ui.saveTo } : undefined,
        },
    };
}, { virtual: true });

jest.mock('../../../../core/constants', () => ({
    ...jest.requireActual('../../../../core/constants'),
    isSystemPath: () => false,
}));

import { SolutionService } from '../../../../services/solution/solutionService';
import { SaveCancelledError } from '../../../../core/saveCancelled';
import { FrameworkChoice } from '../../../../services/project/frameworkChoice';
import { ProjectItemsService } from '../../../../services/project/items/projectItemsService';
import { SolutionActionService } from '../../../../services/solution/solutionActionService';
import { NodeIdService } from '../../../../services/solution/nodeIdService';

class Memento {
    private values = new Map<string, unknown>();
    get<T>(key: string, fallback?: T): T | undefined { return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

let repo: string;
let storage: string;
let app: string;

beforeEach(() => {
    jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-solution-service-'));
    repo = path.join(base, 'repo');
    storage = path.join(base, 'storage', 'temp-solutions');
    app = path.join(repo, 'App', 'App.csproj');
    fs.mkdirSync(path.dirname(app), { recursive: true });
    fs.writeFileSync(app, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    SolutionService.setTemporaryRoot(storage);
    FrameworkChoice.initialize(new Memento() as never);
    ui.button = undefined; ui.saveTo = undefined; ui.asked = []; ui.errors = []; ui.inputBox = undefined;
});
afterEach(() => SolutionService.dispose());

describe('temporary solutions', () => {
    it('open with the given projects, marked temporary, in the storage folder', async () => {
        const solution = await SolutionService.openTemporary(app, 'App', [app]);
        expect(solution?.isTemporary).toBe(true);
        expect(solution!.solutionPath.startsWith(storage)).toBe(true);
        expect([...solution!.projects.keys()]).toEqual([app]);
        expect(SolutionService.getActiveSolution()).toBe(solution);
    });

    it('Save creates the solution next to the project with dotnet, the state follows, then the change is made', async () => {
        ui.button = 'Save...';
        ui.saveTo = path.join(repo, 'App.slnx');
        const solution = (await SolutionService.openTemporary(app, 'App', [app]))!;
        await FrameworkChoice.set(solution.solutionPath, 'net8.0');
        await solution.addSolutionFolder('Libs');
        expect(ui.asked).toHaveLength(1);
        expect(solution.solutionPath).toBe(path.join(repo, 'App.slnx'));
        expect(solution.isTemporary).toBe(false);
        const xml = fs.readFileSync(path.join(repo, 'App.slnx'), 'utf8');
        expect(xml).toMatch(/App\/App\.csproj/);
        expect(xml).toMatch(/\/Libs\//);
        expect(FrameworkChoice.get(path.join(repo, 'App.slnx'))).toBe('net8.0');
    }, 120000);

    it('Save adds projects that reference each other (the runners\' SDK refused that with its --include-references)', async () => {
        const lib = path.join(repo, 'Lib', 'Lib.csproj');
        fs.mkdirSync(path.dirname(lib), { recursive: true });
        fs.writeFileSync(lib, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
        fs.writeFileSync(app, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="..\\Lib\\Lib.csproj" /></ItemGroup></Project>');
        ui.saveTo = path.join(repo, 'Both.slnx');
        const solution = (await SolutionService.openTemporary(repo, 'Both', [app, lib]))!;
        await SolutionService.saveTemporaryAs(solution);
        const xml = fs.readFileSync(path.join(repo, 'Both.slnx'), 'utf8');
        expect(xml.match(/App\.csproj/g)).toHaveLength(1);
        expect(xml.match(/Lib\.csproj/g)).toHaveLength(1);
    }, 120000);

    it('a .sln can be chosen too', async () => {
        ui.button = 'Save...';
        ui.saveTo = path.join(repo, 'App.sln');
        const solution = (await SolutionService.openTemporary(app, 'App', [app]))!;
        await SolutionService.saveTemporaryAs(solution);
        expect(solution.solutionPath).toBe(path.join(repo, 'App.sln'));
        expect(fs.readFileSync(path.join(repo, 'App.sln'), 'utf8')).toMatch(/App[\\/]App\.csproj/);
    }, 120000);

    it('a cancelled save shows no error: Add Solution Folder just does nothing', async () => {
        const solution = (await SolutionService.openTemporary(app, 'App', [app]))!;
        ui.inputBox = 'Libs';
        await SolutionActionService.handleProjectAction({ action: 'addSolutionFolder', nodeId: NodeIdService.generateSolutionId(solution.solutionPath) });
        expect(ui.asked).toHaveLength(1);
        expect(ui.errors).toEqual([]);
        expect(fs.readFileSync(solution.solutionPath, 'utf8')).not.toContain('Libs');
    });

    it('Cancel in the question or in the dialog saves nothing', async () => {
        const solution = (await SolutionService.openTemporary(app, 'App', [app]))!;
        await expect(solution.addSolutionFolder('Libs')).rejects.toBeInstanceOf(SaveCancelledError);
        ui.button = 'Save...';
        await expect(solution.addSolutionFolder('Libs')).rejects.toBeInstanceOf(SaveCancelledError);
        expect(fs.readdirSync(repo).filter(f => /\.slnx?$/.test(f))).toEqual([]);
        expect(solution.isTemporary).toBe(true);
    });
});
