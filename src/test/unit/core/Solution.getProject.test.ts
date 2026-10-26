// Solution.getProject finds the project a folder or file belongs to by its path
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    class EventEmitter<T> {
        private listeners: Array<(value: T) => void> = [];
        event = (listener: (value: T) => void) => { this.listeners.push(listener); return disposable; };
        fire(value?: T) { this.listeners.forEach(listener => listener(value as T)); }
        dispose() { this.listeners = []; }
    }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: {
            createFileSystemWatcher: () => ({ onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } }),
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
        window: { showWarningMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });
afterEach(() => jest.restoreAllMocks());

describe('Solution.getProject', () => {
    let dir: string;
    let solution: Solution;

    const project = (relative: string) => {
        const file = path.join(dir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
    };

    beforeEach(async () => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-getproject-')));
        // `dotnet sln add` writes the project that was added first first: Foo before Foo.Tests, and Outer before Outer/Inner
        project('Cirrus.Packager/Cirrus.Packager.csproj');
        project('Cirrus.Packager.Tests/Cirrus.Packager.Tests.csproj');
        project('Outer/Outer.csproj');
        project('Outer/Inner/Inner.csproj');
        fs.mkdirSync(path.join(dir, 'Cirrus.Packager.Tests', 'Sub'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'Cirrus.Packager', 'Sub'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'Outer', 'Inner', 'Deep'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'App.slnx'), `<Solution>
  <Project Path="Cirrus.Packager/Cirrus.Packager.csproj" />
  <Project Path="Cirrus.Packager.Tests/Cirrus.Packager.Tests.csproj" />
  <Project Path="Outer/Outer.csproj" />
  <Project Path="Outer/Inner/Inner.csproj" />
</Solution>
`);
        solution = new Solution(path.join(dir, 'App.slnx'));
        await solution.ready;
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const nameOf = (folder: string) => solution.getProject(path.join(dir, folder))?.name;

    it('finds a project by its project file', () => {
        expect(nameOf('Cirrus.Packager.Tests/Cirrus.Packager.Tests.csproj')).toBe('Cirrus.Packager.Tests');
    });

    it('finds the project of a folder inside it', () => {
        expect(nameOf('Cirrus.Packager/Sub')).toBe('Cirrus.Packager');
    });

    it('does not take a project whose folder name is only the start of another project folder name', () => {
        // The folder of Cirrus.Packager.Tests starts with the folder of Cirrus.Packager: the folders of the tests expanded empty
        expect(nameOf('Cirrus.Packager.Tests/Sub')).toBe('Cirrus.Packager.Tests');
        expect(nameOf('Cirrus.Packager.Tests')).toBe('Cirrus.Packager.Tests');
    });

    it('takes the innermost project of a nested folder structure', () => {
        expect(nameOf('Outer/Inner/Deep')).toBe('Inner');
        expect(nameOf('Outer/Other')).toBe('Outer');
    });

    it('finds nothing for a path outside every project', () => {
        expect(nameOf('Elsewhere/Sub')).toBeUndefined();
    });
});
