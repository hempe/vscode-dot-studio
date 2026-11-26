// Add Existing Project with `dotnet sln add` (the real SDK): a project that references one the solution has already. On the CI runners
// (SDK 10.0.404) `dotnet sln add` of several projects at once also added their references and then refused a duplicate; this checks the
// extension's own path, one project at a time, on every system the CI runs
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, showErrorMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { ProjectItemsService } from '../../../services/project/items/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });

const project = (references: string[] = [], sdk = 'Microsoft.NET.Sdk') =>
    `<Project Sdk="${sdk}"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>`
    + `<ItemGroup>${references.map(r => `<ProjectReference Include="${r}" />`).join('')}</ItemGroup></Project>`;

describe.each(['slnx', 'sln'])('Add Existing Project (.%s)', kind => {
    it('adds a project that references one already in the solution, once each', async () => {
        // The real path: on macOS the temp folder is under /var, a link to /private/var, and dotnet writes the entry from the real one
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'add-project-')));
        const core = path.join(dir, 'src', 'Core', 'Core.csproj');
        const web = path.join(dir, 'src', 'Web', 'Web.csproj');
        fs.mkdirSync(path.dirname(core), { recursive: true });
        fs.mkdirSync(path.dirname(web), { recursive: true });
        fs.writeFileSync(core, project());
        fs.writeFileSync(web, project(['..\\Core\\Core.csproj'], 'Microsoft.NET.Sdk.Web'));
        const solutionPath = path.join(dir, `App.${kind}`);
        fs.writeFileSync(solutionPath, kind === 'slnx'
            ? '<Solution>\n  <Folder Name="/src/">\n    <Project Path="src/Core/Core.csproj" />\n  </Folder>\n</Solution>\n'
            : [
                '', 'Microsoft Visual Studio Solution File, Format Version 12.00', '# Visual Studio Version 17',
                'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "src", "src", "{00000001-0000-4000-8000-000000000000}"', 'EndProject',
                'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{00000002-0000-4000-8000-000000000000}"', 'EndProject',
                'Global', '\tGlobalSection(NestedProjects) = preSolution', '\t\t{00000002-0000-4000-8000-000000000000} = {00000001-0000-4000-8000-000000000000}', '\tEndGlobalSection', 'EndGlobal', '',
            ].join('\r\n'));
        const solution = new Solution(solutionPath);
        await solution.ready;

        await solution.addProject(web, 'src');

        const text = fs.readFileSync(solutionPath, 'utf8');
        expect(text.match(/Web\.csproj/g)).toHaveLength(1);
        expect(text.match(/Core\.csproj/g)).toHaveLength(1);
        expect([...solution.projects.keys()].sort()).toEqual([core, web].sort());
        solution.dispose();
    }, 120000);
});
