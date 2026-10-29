// Delete and Remove Link on linked files: SolutionActionService with a stubbed solution, on files in a temp folder
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    warnings: [] as { message: string; detail?: string; buttons: string[] }[],
    errors: [] as string[],
    picks: [] as string[][],
};

jest.mock('vscode', () => {
    const nodeFs = require('fs');
    return {
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { fs: { delete: async (uri: { fsPath: string }) => nodeFs.rmSync(uri.fsPath, { recursive: true }) } },
        window: {
            showWarningMessage: async (message: string, ...rest: unknown[]) => {
                const options = rest.find(item => typeof item === 'object') as { detail?: string } | undefined;
                const buttons = rest.filter((item): item is string => typeof item === 'string');
                ui.warnings.push({ message, detail: options?.detail, buttons });
                return buttons.length > 0 ? ui.answers.shift() : undefined;
            },
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
            showQuickPick: async (items: { label: string }[]) => {
                ui.picks.push(items.map(item => item.label));
                const answer = ui.answers.shift();
                return items.find(item => item.label === answer);
            },
        },
    };
}, { virtual: true });

import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { ProjectItems, parseMsbuildItems } from '../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { NodeIdString } from '../../../types/nodeId';

const csproj = (items: string) => `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
${items}
</Project>
`;
const linkItem = '\n  <ItemGroup>\n    <Compile Include="..\\Shared\\Shared.cs" Link="Linked\\Shared.cs" />\n  </ItemGroup>\n';

describe('linked files: Delete and Remove Link', () => {
    let dir: string;
    let shared: string;
    let items: Map<string, ProjectItems | undefined>;
    let projects: Map<string, { name: string; projectPath: string; reevaluateItems: jest.Mock }>;

    const addProject = (name: string, content: string, linksShared: boolean) => {
        const projectPath = path.join(dir, name, `${name}.csproj`);
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
        fs.writeFileSync(projectPath, content);
        fs.writeFileSync(path.join(dir, name, 'Program.cs'), '');
        projects.set(projectPath, { name, projectPath, reevaluateItems: jest.fn() });
        items.set(projectPath, parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Program.cs', FullPath: path.join(dir, name, 'Program.cs') },
                ...(linksShared ? [{ Identity: '..\\Shared\\Shared.cs', FullPath: shared, Link: 'Linked\\Shared.cs' }] : []),
            ] },
        }), path.dirname(projectPath)));
        return projectPath;
    };
    const action = (act: 'deleteFile' | 'removeLink', filePath: string) =>
        SolutionActionService.handleProjectAction({ action: act, nodeId: NodeIdService.generateFileId(filePath) });

    beforeEach(() => {
        ui.answers = [];
        ui.warnings = [];
        ui.errors = [];
        ui.picks = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-linked-')));
        shared = path.join(dir, 'Shared', 'Shared.cs');
        fs.mkdirSync(path.dirname(shared));
        fs.writeFileSync(shared, 'namespace Shared;\n');
        items = new Map();
        projects = new Map();
        jest.spyOn(ProjectItemsService.instance, 'get').mockImplementation(projectPath => items.get(projectPath));
        (SolutionService as any).activeSolution = { projects };
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('Delete on a linked file says that the real file outside the project goes, and deletes it when told to', async () => {
        const app = addProject('App', csproj(linkItem), true);
        ui.answers = ['Delete'];

        await action('deleteFile', shared);

        expect(ui.warnings).toEqual([{
            message: "Delete the linked file 'Shared.cs'?",
            detail: expect.stringContaining(`deletes the real file, outside the project:\n${shared}`),
            buttons: ['Remove Link', 'Delete'],
        }]);
        expect(ui.warnings[0].detail).toContain('App then lists a missing file');
        expect(fs.existsSync(shared)).toBe(false);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));
    });

    test('its Remove Link button removes only the link; Cancel changes nothing', async () => {
        const app = addProject('App', csproj(linkItem), true);
        ui.answers = [undefined];
        await action('deleteFile', shared);
        expect(fs.existsSync(shared)).toBe(true);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));

        ui.answers = ['Remove Link'];
        await action('deleteFile', shared);

        expect(fs.existsSync(shared)).toBe(true);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(''));
        expect(projects.get(app)!.reevaluateItems).toHaveBeenCalledTimes(1);
    });

    test('Delete on a file of the project itself asks as before', async () => {
        addProject('App', csproj(linkItem), true);
        ui.answers = ['Delete'];

        await action('deleteFile', path.join(dir, 'App', 'Program.cs'));

        expect(ui.warnings.map(warning => warning.message)).toEqual(["Delete the file 'Program.cs'? It is moved to the trash."]);
        expect(fs.existsSync(path.join(dir, 'App', 'Program.cs'))).toBe(false);
    });

    test('Remove Link deletes the item, keeps the file and evaluates the project again', async () => {
        const app = addProject('App', csproj(linkItem), true);

        await action('removeLink', shared);

        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(''));
        expect(fs.existsSync(shared)).toBe(true);
        expect(projects.get(app)!.reevaluateItems).toHaveBeenCalledTimes(1);
        expect(ui.warnings).toEqual([]);
    });

    test('Remove Link on a link the project file does not write itself (a wildcard, a props file) says so and changes nothing', async () => {
        const wildcard = csproj('\n  <ItemGroup>\n    <Compile Include="..\\Shared\\*.cs" LinkBase="Linked" />\n  </ItemGroup>\n');
        const app = addProject('App', wildcard, true);

        await action('removeLink', shared);

        expect(fs.readFileSync(app, 'utf8')).toBe(wildcard);
        expect(ui.warnings.map(warning => warning.message)).toEqual([
            'The link to Shared.cs is not an item of its own in App.csproj: a wildcard or another file (Directory.Build.props, an import) adds it. Remove it there.',
        ]);
        expect(projects.get(app)!.reevaluateItems).not.toHaveBeenCalled();
    });

    test('a file linked by several projects: Remove Link asks which one', async () => {
        const app = addProject('App', csproj(linkItem), true);
        const web = addProject('Web', csproj(linkItem), true);
        ui.answers = ['Web'];

        await action('removeLink', shared);

        expect(ui.picks).toEqual([['App', 'Web']]);
        expect(fs.readFileSync(web, 'utf8')).toBe(csproj(''));
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));
    });

    test('a file id that names its project: Remove Link takes that one without asking', async () => {
        const app = addProject('App', csproj(linkItem), true);
        const web = addProject('Web', csproj(linkItem), true);

        await SolutionActionService.handleProjectAction({ action: 'removeLink', nodeId: NodeIdService.generateFileId(shared, app) });

        expect(ui.picks).toEqual([]);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(''));
        expect(fs.readFileSync(web, 'utf8')).toBe(csproj(linkItem));
    });

    test('Delete on several nodes names the linked files among them', async () => {
        addProject('App', csproj(linkItem), true);
        const program = path.join(dir, 'App', 'Program.cs');
        ui.answers = ['Delete'];

        await SolutionActionService.handleMultiAction('deleteFile', [shared, program].map(file => NodeIdService.generateFileId(file)) as NodeIdString[]);

        expect(ui.warnings.map(warning => warning.message)).toEqual([
            `Delete 2 items? They are moved to the trash. One of them is a linked file: the real file outside the project is deleted (${shared}). To remove only a link, use Remove Link on it.`,
        ]);
        expect(fs.existsSync(shared)).toBe(false);
        expect(fs.existsSync(program)).toBe(false);
    });

    const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
    (hasDotnet ? test : test.skip)('real MSBuild: the link is there before Remove Link and gone after it', async () => {
        const app = addProject('App', csproj(linkItem), true);
        const before = await new ProjectItemsService().evaluate(app);
        expect(before?.isLinked(shared)).toBe(true);
        items.set(app, before);

        await action('removeLink', shared);

        const after = await new ProjectItemsService().evaluate(app);
        expect(after).toBeDefined();
        expect(after!.isIncluded(shared)).toBe(false);
        expect(after!.isIncluded(path.join(dir, 'App', 'Program.cs'))).toBe(true);
    }, 150000);
});
