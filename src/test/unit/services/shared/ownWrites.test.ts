import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OwnWrites } from '../../../../services/shared/ownWrites';
import { applyPackageEdits } from '../../../../services/nuget/centralPackageFiles';

describe('OwnWrites', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a file is ours while it is as we wrote it; a later edit or a deletion is not', () => {
        const file = path.join(dir, 'Directory.Packages.props');
        fs.writeFileSync(file, '<Project />');
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        expect(OwnWrites.isOwn(file)).toBe(true);
        fs.writeFileSync(file, '<Project>\n</Project>\n');
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        // same size, another time
        fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        fs.rmSync(file);
        expect(OwnWrites.isOwn(file)).toBe(false);
    });

    test('the package edits record the files they write', async () => {
        const file = path.join(dir, 'Directory.Packages.props');
        fs.writeFileSync(file, '<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.1" />\n  </ItemGroup>\n</Project>\n');
        expect(await applyPackageEdits([{ kind: 'setPackageVersion', file, id: 'Serilog', version: '4.0.0' }])).toEqual([file]);
        expect(OwnWrites.isOwn(file)).toBe(true);
    });
});

describe('OwnWrites with an edit of the same size', () => {
    test('an external edit that keeps size and modification time is not ours', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-'));
        try {
            const file = path.join(dir, 'a.csproj');
            fs.writeFileSync(file, '<Version>1.2.3</Version>');
            const time = new Date(Math.floor(Date.now() / 1000) * 1000);
            fs.utimesSync(file, time, time);
            OwnWrites.record(file);
            fs.writeFileSync(file, '<Version>1.2.4</Version>');
            fs.utimesSync(file, time, time);
            expect(OwnWrites.isOwn(file)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
