import * as path from 'path';
import { dependentRenames } from '../../../../services/templates/dependentRenames';

const dir = path.join('/repo', 'App');
const files = (...names: string[]) => names.map(name => path.join(dir, name));
const renames = (all: string[], file: string, newName: string) =>
    dependentRenames(files(...all), path.join(dir, file), newName).map(([from, to]) => [path.basename(from), path.basename(to)]);

describe('dependentRenames', () => {
    it('renames designer and resource files with their code file', () => {
        expect(renames(['Form1.cs', 'Form1.Designer.cs', 'Form1.resx', 'Form1Helper.cs'], 'Form1.cs', 'Main.cs')).toEqual([
            ['Form1.Designer.cs', 'Main.Designer.cs'],
            ['Form1.resx', 'Main.resx'],
        ]);
    });

    it('renames code-behind and styles with their markup file', () => {
        expect(renames(['Index.cshtml', 'Index.cshtml.cs', 'Index.cshtml.css'], 'Index.cshtml', 'Home.cshtml')).toEqual([
            ['Index.cshtml.cs', 'Home.cshtml.cs'],
            ['Index.cshtml.css', 'Home.cshtml.css'],
        ]);
    });

    it('follows nesting down several levels', () => {
        expect(renames(['Counter.razor', 'Counter.razor.cs', 'Counter.razor.css'], 'Counter.razor', 'Clock.razor').map(([, to]) => to).sort())
            .toEqual(['Clock.razor.cs', 'Clock.razor.css']);
    });

    it('nothing for files without nested files', () => {
        expect(renames(['A.cs', 'B.cs'], 'A.cs', 'C.cs')).toEqual([]);
    });
});
