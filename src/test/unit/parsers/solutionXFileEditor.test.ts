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
});
