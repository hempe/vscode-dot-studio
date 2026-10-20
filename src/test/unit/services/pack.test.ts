import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../../../services/buildConfiguration', () => ({ BuildConfiguration: { active: 'Debug' } }));

import { packagesWrittenSince } from '../../../services/pack';

describe('packagesWrittenSince', () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pack-')));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const write = (name: string, seconds: number) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, '');
        fs.utimesSync(file, seconds, seconds);
        return file;
    };

    it('lists the packages written since the start, newest first, and ignores older ones and other files', () => {
        write('Lib.0.9.0.nupkg', 1000);
        const nupkg = write('Lib.1.0.0.nupkg', 2000);
        const symbols = write('Lib.1.0.0.snupkg', 2001);
        write('Lib.dll', 2002);

        expect(packagesWrittenSince(dir, 1500 * 1000)).toEqual([symbols, nupkg]);
    });

    it('is empty for a folder that does not exist', () => {
        expect(packagesWrittenSince(path.join(dir, 'missing'), 0)).toEqual([]);
    });
});
