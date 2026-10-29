import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiskEntry } from '../../../../services/projectItems/folderLayout';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';
import { changedSince, unlistedEntries, TIMESTAMP_MARGIN_MS } from '../../../../services/projectItems/unseenFiles';

const file = (name: string): DiskEntry => ({ name, isDirectory: false });
const folder = (name: string): DiskEntry => ({ name, isDirectory: true });

describe('unlistedEntries', () => {
    const dir = path.resolve('/work/App');
    const at = (...parts: string[]) => path.join(dir, ...parts);
    const items = parseMsbuildItems(JSON.stringify({
        Items: { Compile: [{ Identity: 'Program.cs', FullPath: at('Program.cs') }, { Identity: 'Sub/Util.cs', FullPath: at('Sub', 'Util.cs') }] },
    }), dir)!;

    test('lists the files and non-empty folders the item list does not include, but not build output or project files', () => {
        const disk = [file('Program.cs'), file('New.cs'), file('App.csproj'), file('Lib.vbproj'), folder('Sub'), folder('Legacy'),
            folder('Empty'), folder('bin'), folder('obj')];
        const nonEmpty = new Set([at('Sub'), at('Legacy'), at('bin'), at('obj')]);
        expect(unlistedEntries(dir, disk, items, nonEmpty)).toEqual([at('New.cs'), at('Legacy')]);
    });
});

describe('changedSince', () => {
    let dir: string;
    const at = (name: string) => path.join(dir, name);
    const write = (name: string, mtimeMs?: number) => {
        fs.writeFileSync(at(name), '');
        if (mtimeMs !== undefined) {
            fs.utimesSync(at(name), mtimeMs / 1000, mtimeMs / 1000);
        }
        return at(name);
    };

    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unseen-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a file written before the evaluation (beyond the margin) is not newer', async () => {
        const old = write('Old.cs');
        // evaluated a minute after the file was written
        expect(await changedSince([old], Date.now() + 60000)).toEqual([]);
    });

    test('a file written or modified after the evaluation is newer, with the time it changed', async () => {
        const written = write('New.cs');
        const evaluatedAt = Date.now() + 60000;
        const modified = write('Modified.cs', evaluatedAt + 10000);
        const result = await changedSince([written, modified], Date.now() - 60000);
        expect(result.map(entry => entry.path)).toEqual([written, modified]);
        expect((await changedSince([written, modified], evaluatedAt)).map(entry => entry.path)).toEqual([modified]);
        expect(result[1].changedAt).toBeGreaterThanOrEqual(evaluatedAt + 9000);
    });

    test('timestamps are coarse: a file changed shortly before the evaluation counts as newer', async () => {
        const evaluatedAt = Date.now() + 60000;
        const close = write('Close.cs', evaluatedAt - TIMESTAMP_MARGIN_MS / 2);
        const before = write('Before.cs', evaluatedAt - TIMESTAMP_MARGIN_MS * 2);
        expect((await changedSince([close, before], evaluatedAt)).map(entry => entry.path)).toEqual([close]);
    });

    test('a folder counts with its own timestamps; an entry gone meanwhile is skipped', async () => {
        fs.mkdirSync(at('Fresh'));
        expect((await changedSince([at('Fresh'), at('Gone.cs')], Date.now() - 60000)).map(entry => entry.path)).toEqual([at('Fresh')]);
    });
});
