// Delete Project moves the project's folder to the trash only when the folder is the project's own (review A2-1)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteProjectPlan } from '../../../../services/project/deleteProject';

describe('deleteProjectPlan', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-delproj-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const at = (...parts: string[]) => path.join(dir, ...parts);

    it('moves the folder of a project that has it to itself', () => {
        const plan = deleteProjectPlan(at('src', 'App', 'App.csproj'), at('App.sln'), [at('src', 'App', 'App.csproj'), at('src', 'Tests', 'Tests.csproj')]);
        expect(plan).toEqual({ kind: 'folder', path: at('src', 'App') });
    });

    it('moves only the project file when the solution file is in the same folder', () => {
        const plan = deleteProjectPlan(at('App.csproj'), at('App.sln'), [at('App.csproj')]);
        expect(plan).toMatchObject({ kind: 'file', path: at('App.csproj') });
    });

    it('moves only the project file when the solution file is below the folder', () => {
        const plan = deleteProjectPlan(at('App', 'App.csproj'), at('App', 'sln', 'All.sln'), [at('App', 'App.csproj')]);
        expect(plan.kind).toBe('file');
    });

    it('moves only the project file when another project of the solution is in or below the folder', () => {
        expect(deleteProjectPlan(at('App.csproj'), at('x', 'All.sln'), [at('App.csproj'), at('Tests', 'Tests.csproj')]).kind).toBe('file');
        expect(deleteProjectPlan(at('App', 'App.csproj'), at('All.sln'), [at('App', 'App.csproj'), at('App', 'App.fsproj')]).kind).toBe('file');
    });

    it('moves only the project file when the folder is a git repository root', () => {
        fs.mkdirSync(at('App', '.git'), { recursive: true });
        expect(deleteProjectPlan(at('App', 'App.csproj'), at('All.sln'), [at('App', 'App.csproj')]).kind).toBe('file');
    });

    it('names the reason', () => {
        const plan = deleteProjectPlan(at('App.csproj'), at('App.sln'), [at('App.csproj')]);
        expect(plan.kind === 'file' && plan.reason).toMatch(/solution/i);
    });
});
