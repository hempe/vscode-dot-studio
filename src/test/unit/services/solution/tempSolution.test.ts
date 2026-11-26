import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findProjectFiles, isTemporarySolution, staleTempFolders, tempSolutionPath, tempSolutionXml } from '../../../../services/solution/tempSolution';

describe('temporary solutions', () => {
    const root = path.join(os.tmpdir(), 'storage', 'temp-solutions');

    it('lives in a folder per key, named after the project or folder', () => {
        const a = tempSolutionPath(root, '/repo/App/App.csproj', 'App');
        expect(path.dirname(path.dirname(a))).toBe(root);
        expect(path.basename(a)).toBe('App.slnx');
        expect(tempSolutionPath(root, '/repo/App/App.csproj', 'App')).toBe(a);
        expect(tempSolutionPath(root, '/repo/Other', 'Other')).not.toBe(a);
    });

    it('lists the projects relative to its own folder, with forward slashes', () => {
        const xml = tempSolutionXml(path.join(path.sep, 's', 'h'), [path.join(path.sep, 'repo', 'App', 'App.csproj'), path.join(path.sep, 'repo', 'Lib', 'Lib.vbproj')]);
        expect(xml).toBe('<Solution>\n  <Project Path="../../repo/App/App.csproj" />\n  <Project Path="../../repo/Lib/Lib.vbproj" />\n</Solution>\n');
    });

    it('knows its own files', () => {
        expect(isTemporarySolution(root, path.join(root, 'abc', 'App.slnx'))).toBe(true);
        expect(isTemporarySolution(root, path.join(path.sep, 'repo', 'App.slnx'))).toBe(false);
        expect(isTemporarySolution(undefined, path.join(root, 'abc', 'App.slnx'))).toBe(false);
    });

    it('finds project files three levels down, skipping build output and hidden folders', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempsln-'));
        const write = (p: string) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), '<Project />'); };
        write('src/App/App.csproj'); write('src/Lib/Lib.fsproj'); write('a/b/c/d/Deep.csproj'); write('src/App/bin/Copy.csproj'); write('.git/X.csproj');
        expect((await findProjectFiles(dir)).map(p => path.relative(dir, p).split(path.sep).join('/'))).toEqual(['src/App/App.csproj', 'src/Lib/Lib.fsproj']);
    });

    it('names the folders not used for 30 days', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempsln-'));
        fs.mkdirSync(path.join(dir, 'old')); fs.mkdirSync(path.join(dir, 'new'));
        const now = Date.now();
        fs.utimesSync(path.join(dir, 'old'), new Date(now - 31 * 86400000), new Date(now - 31 * 86400000));
        expect(staleTempFolders(dir, now)).toEqual([path.join(dir, 'old')]);
        expect(staleTempFolders(path.join(dir, 'missing'), now)).toEqual([]);
    });
});
