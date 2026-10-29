import { candidateFiles } from '../../../../../services/code/namespaceSync/syncPlan';

describe('candidateFiles', () => {
    it('keeps only .cs files, sorted by path', () => {
        expect(candidateFiles(['/p/b.cs', '/p/a.cs', '/p/readme.md', '/p/x.csproj', '/p/Sub/c.CS'])).toEqual(['/p/Sub/c.CS', '/p/a.cs', '/p/b.cs']);
    });

    it('drops bin, obj, node_modules and hidden folders', () => {
        expect(candidateFiles([
            '/p/bin/Debug/a.cs', '/p/obj/b.cs', '/p/node_modules/x/c.cs', '/p/.git/d.cs', '/p/.vs/e.cs', '/p/Sub/obj/f.cs', '/p/Sub/ok.cs',
        ])).toEqual(['/p/Sub/ok.cs']);
    });

    it('drops generated files in any case', () => {
        expect(candidateFiles([
            '/p/A.g.cs', '/p/A.g.i.cs', '/p/Form.Designer.cs', '/p/x.designer.cs', '/p/Properties/Foo.AssemblyInfo.cs', '/p/Real.cs',
        ])).toEqual(['/p/Real.cs']);
    });

    it('handles Windows separators', () => {
        expect(candidateFiles(['C:\\p\\bin\\a.cs', 'C:\\p\\Sub\\b.cs'])).toEqual(['C:\\p\\Sub\\b.cs']);
    });

    it('does not treat names that merely contain bin or obj as excluded', () => {
        expect(candidateFiles(['/p/binary/a.cs', '/p/objects/b.cs'])).toEqual(['/p/binary/a.cs', '/p/objects/b.cs']);
    });

    it('only looks at the folders below the root', () => {
        expect(candidateFiles(['/home/me/.work/p/a.cs', '/home/me/.work/p/obj/b.cs'], '/home/me/.work/p')).toEqual(['/home/me/.work/p/a.cs']);
    });
});
