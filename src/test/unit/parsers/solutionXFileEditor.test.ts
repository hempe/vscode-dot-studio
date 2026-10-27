import { SolutionXFileEditor } from '../../../parsers/solutionXFileEditor';
import { SolutionXFileParser } from '../../../parsers/solutionXFileParser';
import { PROJECT_TYPE_GUIDS, SolutionFile } from '../../../types/solution';

describe('SolutionXFileEditor', () => {
    const sample = `<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <File Path="src/README.md" />
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
  <Project Path="App/App.csproj" />
</Solution>
`;

    // "Name <- Parent" for every folder, plus "item: path <- Parent" for projects and files
    const structure = async (content: string) => {
        const s: SolutionFile = await SolutionXFileParser.parse(content);
        const fullName = (guid: string | undefined): string => {
            const p = s.projects.find(x => x.guid === guid);
            if (!p) return 'ROOT';
            const parent = s.nestedProjects.find(n => n.childGuid === guid)?.parentGuid;
            return parent ? `${fullName(parent)}/${p.name}` : p.name;
        };
        const lines: string[] = [];
        for (const p of s.projects) {
            if (p.typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER) {
                lines.push(`folder ${fullName(p.guid)}`);
                for (const section of p.projectSections ?? []) {
                    for (const file of Object.keys(section.items)) {
                        lines.push(`file ${file} <- ${fullName(p.guid)}`);
                    }
                }
            } else {
                const parent = s.nestedProjects.find(n => n.childGuid === p.guid)?.parentGuid;
                lines.push(`project ${p.path} <- ${fullName(parent)}`);
            }
        }
        return lines.sort();
    };

    describe('addFolder', () => {
        test('adds a root folder in sorted position with matching indentation', () => {
            const result = SolutionXFileEditor.addFolder(sample, ['Docs']);

            expect(result).toBe(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/Docs/" />
  <Folder Name="/src/">
    <File Path="src/README.md" />
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
  <Project Path="App/App.csproj" />
</Solution>
`);
        });

        test('adds a nested folder', async () => {
            const result = SolutionXFileEditor.addFolder(sample, ['src', 'libs']);

            expect(await structure(result)).toContain('folder src/libs');
            expect(result).toContain('  <Folder Name="/src/libs/" />\n  <Project Path="App/App.csproj" />');
        });

        test('creates missing ancestor folder elements', () => {
            const result = SolutionXFileEditor.addFolder(sample, ['a', 'b']);

            expect(result).toContain('<Folder Name="/a/" />');
            expect(result).toContain('<Folder Name="/a/b/" />');
        });

        test('adds a folder to a solution without folders or projects', () => {
            expect(SolutionXFileEditor.addFolder('<Solution>\n</Solution>\n', ['New']))
                .toBe('<Solution>\n  <Folder Name="/New/" />\n</Solution>\n');
            expect(SolutionXFileEditor.addFolder('<Solution />', ['New']))
                .toBe('<Solution>\n  <Folder Name="/New/" />\n</Solution>');
        });

        test('adds a folder before root projects when there are no folders', () => {
            const result = SolutionXFileEditor.addFolder('<Solution>\n  <Project Path="A/A.csproj" />\n</Solution>\n', ['New']);

            expect(result).toBe('<Solution>\n  <Folder Name="/New/" />\n  <Project Path="A/A.csproj" />\n</Solution>\n');
        });

        test('preserves CRLF line endings and tab indentation', () => {
            const crlf = '<Solution>\r\n\t<Folder Name="/b/" />\r\n</Solution>\r\n';

            expect(SolutionXFileEditor.addFolder(crlf, ['a']))
                .toBe('<Solution>\r\n\t<Folder Name="/a/" />\r\n\t<Folder Name="/b/" />\r\n</Solution>\r\n');
        });

        test('escapes special characters in names', async () => {
            const result = SolutionXFileEditor.addFolder(sample, ['R&D "x"']);

            expect(result).toContain('<Folder Name="/R&amp;D &quot;x&quot;/" />');
            expect(await structure(result)).toContain('folder R&D "x"');
        });

        test('rejects duplicates and invalid names', () => {
            expect(() => SolutionXFileEditor.addFolder(sample, ['src'])).toThrow('already exists');
            expect(() => SolutionXFileEditor.addFolder(sample, ['a/b'])).toThrow('Invalid');
            expect(() => SolutionXFileEditor.addFolder(sample, ['  '])).toThrow('Invalid');
        });
    });

    describe('removeFolder', () => {
        test('removes the folder, its descendants and their projects', async () => {
            const result = SolutionXFileEditor.removeFolder(sample, ['Deep']);

            expect(result).toBe(`<Solution>
  <Folder Name="/src/">
    <File Path="src/README.md" />
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
  <Project Path="App/App.csproj" />
</Solution>
`);
        });

        test('does not remove folders that only share a name prefix', async () => {
            const content = '<Solution>\n  <Folder Name="/src/" />\n  <Folder Name="/src2/" />\n</Solution>\n';

            expect(SolutionXFileEditor.removeFolder(content, ['src']))
                .toBe('<Solution>\n  <Folder Name="/src2/" />\n</Solution>\n');
        });

        test('removes descendants of a folder that has no element of its own', () => {
            const content = '<Solution>\n  <Folder Name="/a/b/" />\n  <Folder Name="/c/" />\n</Solution>\n';

            expect(SolutionXFileEditor.removeFolder(content, ['a']))
                .toBe('<Solution>\n  <Folder Name="/c/" />\n</Solution>\n');
        });

        test('throws when folder does not exist', () => {
            expect(() => SolutionXFileEditor.removeFolder(sample, ['nope'])).toThrow('not found');
        });
    });

    describe('renameFolder', () => {
        test('renames the folder and the paths of its descendants', async () => {
            const result = SolutionXFileEditor.renameFolder(sample, ['Deep'], 'Shallow');

            expect(await structure(result)).toEqual(await structure(sample.replace(/\/Deep\//g, '/Shallow/')));
            expect(result).toContain('<Folder Name="/Shallow/Deeper/">');
        });

        test('renames a nested folder', async () => {
            const result = SolutionXFileEditor.renameFolder(sample, ['Deep', 'Deeper'], 'Lower');

            expect(result).toContain('<Folder Name="/Deep/" />\n  <Folder Name="/Deep/Lower/">');
        });

        test('rejects renaming onto an existing folder', () => {
            expect(() => SolutionXFileEditor.renameFolder(sample, ['Deep'], 'src')).toThrow('already exists');
        });
    });

    describe('addFile', () => {
        test('adds a file to a self-closing folder', async () => {
            const result = SolutionXFileEditor.addFile(sample, ['Deep'], 'docs/a.md');

            expect(result).toContain('  <Folder Name="/Deep/">\n    <File Path="docs/a.md" />\n  </Folder>\n');
            expect(await structure(result)).toContain('file docs/a.md <- Deep');
        });

        test('adds a file after existing files of a folder', () => {
            const result = SolutionXFileEditor.addFile(sample, ['src'], 'src/b.md');

            expect(result).toContain('    <File Path="src/README.md" />\n    <File Path="src/b.md" />\n    <Project');
        });

        test('adds a file before projects when folder has no files', () => {
            const result = SolutionXFileEditor.addFile(sample, ['Deep', 'Deeper'], 'x.txt');

            expect(result).toContain('<Folder Name="/Deep/Deeper/">\n    <File Path="x.txt" />\n    <Project Path="src/nested/Inner/Inner.csproj" />');
        });

        test('creates the folder element for an implicit folder', async () => {
            const content = '<Solution>\n  <Folder Name="/a/b/" />\n</Solution>\n';
            const result = SolutionXFileEditor.addFile(content, ['a'], 'x.txt');

            expect(await structure(result)).toContain('file x.txt <- a');
        });

        test('rejects a file that is already in the folder', () => {
            expect(() => SolutionXFileEditor.addFile(sample, ['src'], 'src\\README.md')).toThrow('already');
        });
    });

    describe('removeFile', () => {
        test('removes the file and keeps the folder', async () => {
            const result = SolutionXFileEditor.removeFile(sample, 'src/README.md');

            expect(result).toContain('  <Folder Name="/src/">\n    <Project Path="src/Lib/Lib.csproj" />\n  </Folder>');
        });

        test('collapses a folder that becomes empty', () => {
            const content = '<Solution>\n  <Folder Name="/Solution Items/">\n    <File Path="README.md" />\n  </Folder>\n</Solution>\n';

            expect(SolutionXFileEditor.removeFile(content, 'README.md'))
                .toBe('<Solution>\n  <Folder Name="/Solution Items/" />\n</Solution>\n');
        });

        test('matches paths regardless of separator', () => {
            const content = '<Solution>\n  <Folder Name="/x/">\n    <File Path="a\\b.md" />\n  </Folder>\n</Solution>\n';

            expect(SolutionXFileEditor.removeFile(content, 'a/b.md')).toBe('<Solution>\n  <Folder Name="/x/" />\n</Solution>\n');
        });

        test('throws when file is not in the solution', () => {
            expect(() => SolutionXFileEditor.removeFile(sample, 'nope.md')).toThrow('not found');
        });
    });

    describe('moveProject', () => {
        test('moves a root project to the end of a folder', () => {
            expect(SolutionXFileEditor.moveProject(sample, 'App/App.csproj', ['src'])).toBe(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <File Path="src/README.md" />
    <Project Path="src/Lib/Lib.csproj" />
    <Project Path="App/App.csproj" />
  </Folder>
</Solution>
`);
        });

        test('moves a project to the root, after the root projects', () => {
            expect(SolutionXFileEditor.moveProject(sample, 'src/Lib/Lib.csproj', [])).toBe(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <File Path="src/README.md" />
  </Folder>
  <Project Path="App/App.csproj" />
  <Project Path="src/Lib/Lib.csproj" />
</Solution>
`);
        });

        test('a folder left empty becomes self-closing; a self-closing target opens', async () => {
            const result = SolutionXFileEditor.moveProject(sample, 'src/nested/Inner/Inner.csproj', ['Deep']);

            expect(result).toContain('  <Folder Name="/Deep/">\n    <Project Path="src/nested/Inner/Inner.csproj" />\n  </Folder>\n  <Folder Name="/Deep/Deeper/" />\n');
            expect(await structure(result)).toContain('project src/nested/Inner/Inner.csproj <- Deep');
        });

        test('to the root when there is no root project: before </Solution>', () => {
            const noRoot = sample.replace('  <Project Path="App/App.csproj" />\n', '');
            expect(SolutionXFileEditor.moveProject(noRoot, 'src/Lib/Lib.csproj', [])).toMatch(/  <Project Path="src\/Lib\/Lib.csproj" \/>\n<\/Solution>\n$/);
        });

        test('moves child elements along, re-indented, and matches paths regardless of separator', () => {
            const withChild = sample.replace('  <Project Path="App/App.csproj" />',
                '  <Project Path="App/App.csproj">\n    <BuildType Project="Release" />\n  </Project>');
            expect(SolutionXFileEditor.moveProject(withChild, 'App\\App.csproj', ['src'])).toContain(
                '    <Project Path="src/Lib/Lib.csproj" />\n    <Project Path="App/App.csproj">\n      <BuildType Project="Release" />\n    </Project>\n  </Folder>');
        });

        test('throws for a project that is not there', () => {
            expect(() => SolutionXFileEditor.moveProject(sample, 'Nope/Nope.csproj', [])).toThrow('not found');
        });

        test('keeps CRLF line endings and tab indentation', () => {
            const crlf = '<Solution>\r\n\t<Folder Name="/a/" />\r\n\t<Folder Name="/b/">\r\n\t\t<Project Path="B/B.csproj">\r\n\t\t\t<Build Project="false" />\r\n\t\t</Project>\r\n\t</Folder>\r\n</Solution>\r\n';

            const intoA = SolutionXFileEditor.moveProject(crlf, 'B/B.csproj', ['a']);
            expect(intoA).toBe('<Solution>\r\n\t<Folder Name="/a/">\r\n\t\t<Project Path="B/B.csproj">\r\n\t\t\t<Build Project="false" />\r\n\t\t</Project>\r\n\t</Folder>\r\n\t<Folder Name="/b/" />\r\n</Solution>\r\n');
            expect(SolutionXFileEditor.moveProject(intoA, 'B/B.csproj', []))
                .toBe('<Solution>\r\n\t<Folder Name="/a/" />\r\n\t<Folder Name="/b/" />\r\n\t<Project Path="B/B.csproj">\r\n\t\t<Build Project="false" />\r\n\t</Project>\r\n</Solution>\r\n');
        });

        test('into a folder that only exists implicitly, and into a folder written on one line', async () => {
            const implicit = SolutionXFileEditor.moveProject(sample, 'App/App.csproj', ['Other', 'Sub']);
            expect(await structure(implicit)).toEqual(expect.arrayContaining(['folder Other', 'folder Other/Sub', 'project App/App.csproj <- Other/Sub']));

            const oneLine = '<Solution>\n  <Folder Name="/x/"><Project Path="X/X.csproj" /></Folder>\n  <Project Path="A/A.csproj" />\n</Solution>\n';
            const result = SolutionXFileEditor.moveProject(oneLine, 'A/A.csproj', ['x']);
            expect(await structure(result)).toEqual(['folder x', 'project A/A.csproj <- x', 'project X/X.csproj <- x']);
        });
    });

    describe('XML comments (review A1-08)', () => {
        const commented = `<Solution>
  <Folder Name="/src/">
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
  <Project Path="App/App.csproj" />
  <!-- <Project Path="Old/Old.csproj" /> -->
</Solution>
`;

        it('puts a project moved to the root after the last project, not inside a trailing comment', () => {
            const result = SolutionXFileEditor.moveProject(commented, 'src/Lib/Lib.csproj', []);
            expect(result).toBe(`<Solution>
  <Folder Name="/src/" />
  <Project Path="App/App.csproj" />
  <Project Path="src/Lib/Lib.csproj" />
  <!-- <Project Path="Old/Old.csproj" /> -->
</Solution>
`);
        });

        it('does not find a project or a folder that is commented out', () => {
            expect(() => SolutionXFileEditor.moveProject(commented, 'Old/Old.csproj', [])).toThrow('not found');
            const folderComment = '<Solution>\n  <!-- <Folder Name="/x/" /> -->\n</Solution>\n';
            expect(() => SolutionXFileEditor.removeFolder(folderComment, ['x'])).toThrow('not found');
            const added = SolutionXFileEditor.addFolder(folderComment, ['x']);
            expect(added).toContain('\n  <Folder Name="/x/" />\n');
            expect(added).toContain('<!-- <Folder Name="/x/" /> -->');
        });

        it('inserts a first folder before the first real project, not before a commented one', () => {
            const content = '<Solution>\n  <!-- <Project Path="Old/Old.csproj" /> -->\n  <Project Path="App/App.csproj" />\n</Solution>\n';
            expect(SolutionXFileEditor.addFolder(content, ['docs'])).toBe(
                '<Solution>\n  <!-- <Project Path="Old/Old.csproj" /> -->\n  <Folder Name="/docs/" />\n  <Project Path="App/App.csproj" />\n</Solution>\n');
        });
    });

    describe('moveFolder', () => {
        test('renames the folder and its descendants under the target; elements stay in place', async () => {
            const result = SolutionXFileEditor.moveFolder(sample, ['Deep'], ['src']);

            expect(result).toBe(sample.replace('"/Deep/"', '"/src/Deep/"').replace('"/Deep/Deeper/"', '"/src/Deep/Deeper/"'));
            expect(await structure(result)).toEqual(expect.arrayContaining([
                'folder src/Deep',
                'folder src/Deep/Deeper',
                'project src/nested/Inner/Inner.csproj <- src/Deep/Deeper',
            ]));
        });

        test('moves a nested folder to the root', () => {
            expect(SolutionXFileEditor.moveFolder(sample, ['Deep', 'Deeper'], [])).toContain('<Folder Name="/Deeper/">');
        });

        test('refuses itself, its descendants and a name the target has', () => {
            expect(() => SolutionXFileEditor.moveFolder(sample, ['Deep'], ['Deep', 'Deeper'])).toThrow('into itself');
            expect(() => SolutionXFileEditor.moveFolder(sample, ['Deep'], ['Deep'])).toThrow('into itself');
            const withDuplicate = sample.replace('  <Project Path="App/App.csproj" />', '  <Folder Name="/src/Deeper/" />\n  <Project Path="App/App.csproj" />');
            expect(() => SolutionXFileEditor.moveFolder(withDuplicate, ['Deep', 'Deeper'], ['src'])).toThrow('already exists');
        });

        test('a folder may go into a folder of the same name, or of a name it starts with', async () => {
            const content = '<Solution>\n  <Folder Name="/Deep/" />\n  <Folder Name="/Deeper/" />\n  <Folder Name="/Shared/" />\n  <Folder Name="/src/Shared/" />\n</Solution>\n';

            expect(await structure(SolutionXFileEditor.moveFolder(content, ['Shared'], ['src', 'Shared']))).toContain('folder src/Shared/Shared');
            expect(await structure(SolutionXFileEditor.moveFolder(content, ['Deep'], ['Deeper']))).toContain('folder Deeper/Deep');
        });

        test('a folder without an element of its own moves with its descendants; Ids are kept', async () => {
            const content = '<Solution>\n  <Folder Name="/a/b/" Id="11111111-2222-3333-4444-555555555555">\n    <Project Path="B/B.csproj" />\n  </Folder>\n  <Folder Name="/c/" />\n</Solution>\n';
            const result = SolutionXFileEditor.moveFolder(content, ['a'], ['c']);

            expect(result).toBe(content.replace('"/a/b/"', '"/c/a/b/"'));
            expect(await structure(result)).toEqual(['folder c', 'folder c/a', 'folder c/a/b', 'project B/B.csproj <- c/a/b']);
        });

        test('keeps CRLF line endings', () => {
            const crlf = sample.replace(/\n/g, '\r\n');
            expect(SolutionXFileEditor.moveFolder(crlf, ['Deep'], ['src']))
                .toBe(crlf.replace('"/Deep/"', '"/src/Deep/"').replace('"/Deep/Deeper/"', '"/src/Deep/Deeper/"'));
        });
    });

    describe('moveFile', () => {
        test('moves a solution item from one folder to another', async () => {
            const result = SolutionXFileEditor.moveFile(sample, ['src'], 'src/README.md', ['Deep']);

            expect(result).toContain('  <Folder Name="/Deep/">\n    <File Path="src/README.md" />\n  </Folder>\n');
            expect(result).toContain('  <Folder Name="/src/">\n    <Project Path="src/Lib/Lib.csproj" />\n  </Folder>\n');
            expect(await structure(result)).toContain('file src/README.md <- Deep');
        });

        test('throws when the file is not in that folder', () => {
            expect(() => SolutionXFileEditor.moveFile(sample, ['Deep'], 'src/README.md', ['src'])).toThrow('not found');
        });

        test('a folder left empty becomes self-closing; keeps CRLF and the path as written', () => {
            const crlf = '<Solution>\r\n  <Folder Name="/a/" />\r\n  <Folder Name="/b/">\r\n    <File Path="docs\\x.md" />\r\n  </Folder>\r\n</Solution>\r\n';

            expect(SolutionXFileEditor.moveFile(crlf, ['b'], 'docs/x.md', ['a']))
                .toBe('<Solution>\r\n  <Folder Name="/a/">\r\n    <File Path="docs\\x.md" />\r\n  </Folder>\r\n  <Folder Name="/b/" />\r\n</Solution>\r\n');
        });
    });
});
