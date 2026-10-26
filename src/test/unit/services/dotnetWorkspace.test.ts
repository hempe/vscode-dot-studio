// The context key behind F5/Ctrl+F5 and the Solution Explorer is set from what the folders hold (review A7-9)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ workspace: {}, window: {}, commands: {} }), { virtual: true });

import { workspaceHasDotnetFiles } from '../../../services/dotnetWorkspace';

describe('workspaceHasDotnetFiles', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-ws-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('is false for a folder without .NET files', async () => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        expect(await workspaceHasDotnetFiles([dir])).toBe(false);
        expect(await workspaceHasDotnetFiles([])).toBe(false);
    });

    it('is true with a solution in the folder or a few folders down', async () => {
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'App.slnx'), '<Solution />');
        expect(await workspaceHasDotnetFiles([dir])).toBe(true);
    });

    it('is true with a project file in the folder and no solution', async () => {
        fs.writeFileSync(path.join(dir, 'App.fsproj'), '<Project />');
        expect(await workspaceHasDotnetFiles([dir])).toBe(true);
    });

    it('is true when one of several folders qualifies', async () => {
        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-ws2-'));
        try {
            fs.writeFileSync(path.join(other, 'App.sln'), '');
            expect(await workspaceHasDotnetFiles([dir, other])).toBe(true);
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });
});
