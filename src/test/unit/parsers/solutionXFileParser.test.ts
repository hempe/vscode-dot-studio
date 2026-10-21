import { SolutionXFileParser } from '../../../parsers/solutionXFileParser';
import { PROJECT_TYPE_GUIDS, SolutionFile, SolutionProject } from '../../../types/solution';

describe('SolutionXFileParser', () => {
    // Real-world .slnx: folders are flat, hierarchy is encoded in the Name path
    const sampleSlnxContent = `<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
    <Platform Name="Any CPU" />
    <Platform Name="x64" />
  </Configurations>
  <Folder Name="/Solution Items/">
    <File Path="README.md" />
    <File Path="Directory.Build.props" />
  </Folder>
  <Folder Name="/src/" />
  <Folder Name="/src/libs/">
    <Project Path="src/Lib/Lib.csproj" />
    <Project Path="src\\VbLib\\VbLib.vbproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/Tests/Tests.fsproj" Id="{8B5F3D7A-1234-4A5B-9C8D-1E2F3A4B5C6D}" />
  </Folder>
  <Project Path="App/App.csproj" />
</Solution>`;

    const folder = (solution: SolutionFile, name: string) =>
        solution.projects.find(p => p.typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER && p.name === name);
    const project = (solution: SolutionFile, name: string) =>
        solution.projects.find(p => p.typeGuid !== PROJECT_TYPE_GUIDS.SOLUTION_FOLDER && p.name === name);
    const parentOf = (solution: SolutionFile, item: SolutionProject) =>
        solution.nestedProjects.find(n => n.childGuid === item.guid)?.parentGuid;

    describe('parse', () => {
        test('should parse basic .slnx file', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            expect(result.formatVersion).toBe('1.0');
            expect(result.projects).toHaveLength(8); // 4 projects + 4 folders
        });

        test('should parse output of `dotnet sln` (implicit and nested folders)', async () => {
            const result = await SolutionXFileParser.parse(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
</Solution>`);

            const deep = folder(result, 'Deep')!;
            const deeper = folder(result, 'Deeper')!;
            const src = folder(result, 'src')!;
            expect(deep).toBeDefined();
            expect(deeper).toBeDefined();
            expect(src).toBeDefined();

            expect(parentOf(result, deep)).toBeUndefined();
            expect(parentOf(result, deeper)).toBe(deep.guid);
            expect(parentOf(result, project(result, 'Inner')!)).toBe(deeper.guid);
            expect(parentOf(result, project(result, 'Lib')!)).toBe(src.guid);
        });

        test('should create missing ancestor folders', async () => {
            const result = await SolutionXFileParser.parse(`<Solution>
  <Folder Name="/a/b/c/">
    <Project Path="X/X.csproj" />
  </Folder>
</Solution>`);

            const a = folder(result, 'a')!;
            const b = folder(result, 'b')!;
            const c = folder(result, 'c')!;
            expect(a).toBeDefined();
            expect(parentOf(result, b)).toBe(a.guid);
            expect(parentOf(result, c)).toBe(b.guid);
            expect(result.projects.filter(p => p.typeGuid === PROJECT_TYPE_GUIDS.SOLUTION_FOLDER)).toHaveLength(3);
        });

        test('should parse projects correctly', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            const app = project(result, 'App')!;
            expect(app.typeGuid).toBe(PROJECT_TYPE_GUIDS.CSHARP_PROJECT);
            expect(app.path).toBe('App/App.csproj');
            expect(parentOf(result, app)).toBeUndefined();

            expect(project(result, 'VbLib')!.typeGuid).toBe(PROJECT_TYPE_GUIDS.VB_PROJECT);
            expect(project(result, 'Tests')!.typeGuid).toBe(PROJECT_TYPE_GUIDS.FSHARP_PROJECT);
        });

        test('should normalize backslashes in project paths', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            expect(project(result, 'VbLib')!.path).toBe('src/VbLib/VbLib.vbproj');
        });

        test('should use explicit Id when present', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            expect(project(result, 'Tests')!.guid).toBe('{8B5F3D7A-1234-4A5B-9C8D-1E2F3A4B5C6D}');
        });

        test('should generate stable ids across parses', async () => {
            const first = await SolutionXFileParser.parse(sampleSlnxContent);
            const second = await SolutionXFileParser.parse(sampleSlnxContent);

            expect(second.projects.map(p => p.guid)).toEqual(first.projects.map(p => p.guid));
            expect(second.nestedProjects).toEqual(first.nestedProjects);
            expect(new Set(first.projects.map(p => p.guid)).size).toBe(first.projects.length);
            for (const p of first.projects) {
                expect(p.guid).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
            }
        });

        test('should use the Id of a folder declared after a folder inside it (as a moved folder leaves it)', async () => {
            const result = await SolutionXFileParser.parse(`<Solution>
  <Folder Name="/Tools/Shared/">
    <Project Path="Lib/Lib.csproj" />
  </Folder>
  <Folder Name="/Tools/" Id="{0D2BD4A5-4D1E-4D4E-9A7A-111111111111}" />
</Solution>`);

            const tools = folder(result, 'Tools')!;
            expect(tools.guid).toBe('{0D2BD4A5-4D1E-4D4E-9A7A-111111111111}');
            expect(result.nestedProjects).toContainEqual({ childGuid: folder(result, 'Shared')!.guid, parentGuid: tools.guid });
        });

        test('should give same-named folders in different places different ids', async () => {
            const result = await SolutionXFileParser.parse(`<Solution>
  <Folder Name="/a/Inner/" />
  <Folder Name="/b/Inner/" />
</Solution>`);

            const inners = result.projects.filter(p => p.name === 'Inner');
            expect(inners).toHaveLength(2);
            expect(inners[0].guid).not.toBe(inners[1].guid);
        });

        test('should parse solution items (files) correctly', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            const solutionItems = folder(result, 'Solution Items')!;
            expect(solutionItems.projectSections).toHaveLength(1);
            expect(solutionItems.projectSections![0].name).toBe('SolutionItems');
            expect(Object.keys(solutionItems.projectSections![0].items)).toEqual(['README.md', 'Directory.Build.props']);
        });

        test('should parse configurations correctly', async () => {
            const result = await SolutionXFileParser.parse(sampleSlnxContent);

            const configSection = result.globalSections.find(s => s.name === 'SolutionConfigurationPlatforms');
            expect(configSection).toBeDefined();
            expect(configSection!.type).toBe('preSolution');
            expect(Object.keys(configSection!.items)).toEqual([
                'Debug|Any CPU', 'Debug|x64', 'Release|Any CPU', 'Release|x64'
            ]);
        });

        test.each([
            ['empty element', '<Solution></Solution>'],
            ['self-closing element', '<Solution />'],
            ['`dotnet new sln --format slnx` output', '<Solution>\n</Solution>\n'],
        ])('should parse empty solution (%s)', async (_, content) => {
            const result = await SolutionXFileParser.parse(content);

            expect(result.projects).toEqual([]);
            expect(result.nestedProjects).toEqual([]);
            expect(result.globalSections).toEqual([]);
        });

        test('should throw error for invalid root element', async () => {
            await expect(SolutionXFileParser.parse('<InvalidRoot></InvalidRoot>')).rejects.toThrow(
                'Invalid .slnx file: missing <Solution> root element'
            );
        });

        // Same rules as `dotnet sln list` (Microsoft.VisualStudio.SolutionPersistence)
        test.each([
            ['folder name without slashes', '<Solution><Folder Name="Inner" /></Solution>', "Solution folder name 'Inner' must start and end with '/'"],
            ['folder name without trailing slash', '<Solution><Folder Name="/a" /></Solution>', "Solution folder name '/a' must start and end with '/'"],
            ['root folder name', '<Solution><Folder Name="/" /></Solution>', "Solution folder name '/' must start and end with '/'"],
            ['folder without name', '<Solution><Folder /></Solution>', "Missing 'Name' on <Folder>"],
            ['duplicate folder (case-insensitive)', '<Solution><Folder Name="/a/" /><Folder Name="/A/" /></Solution>', "Duplicate folder '/A/'"],
            ['project without path', '<Solution><Project /></Solution>', "Missing 'Path' on <Project>"],
            ['duplicate project', '<Solution><Project Path="A/A.csproj" /><Project Path="A/A.csproj" /></Solution>', "Duplicate project 'A/A.csproj'"],
            ['duplicate project (case and separator)', '<Solution><Project Path="A/A.csproj" /><Project Path="a\\A.csproj" /></Solution>', "Duplicate project 'a\\A.csproj'"],
            ['duplicate project across folders', '<Solution><Folder Name="/x/"><Project Path="A/A.csproj" /></Folder><Project Path="A/A.csproj" /></Solution>', "Duplicate project 'A/A.csproj'"],
        ])('should reject invalid .slnx that dotnet rejects (%s)', async (_, content, message) => {
            await expect(SolutionXFileParser.parse(content)).rejects.toThrow(`Invalid .slnx file: ${message}`);
        });

        test('should reject hand-nested folders with bare names', async () => {
            const content = `<Solution>
  <Project Path="ConsoleApp\\ConsoleApp.csproj" />
  <Folder Name="Solution Items">
    <Folder Name="Inner">
      <File Path="nuget.config" />
    </Folder>
  </Folder>
</Solution>`;

            await expect(SolutionXFileParser.parse(content)).rejects.toThrow(
                "Invalid .slnx file: Solution folder name 'Solution Items' must start and end with '/'"
            );
        });

        test('should accept what dotnet accepts but ignores', async () => {
            const content = `<Solution>
  <Properties><Property Name="x" Value="y" /></Properties>
  <Folder Name="/a/"><Folder Name="/a/b/" /></Folder>
  <Folder Name="/c/d/" />
  <Project Path="A/A.csproj" Id="{9C6F4E8B-5678-4B6C-AD9E-2F3G4B5C6D7E}" />
</Solution>`;

            const result = await SolutionXFileParser.parse(content);

            expect(result.projects.map(p => p.name).sort()).toEqual(['A', 'a', 'c', 'd']);
        });
    });

    describe('utility methods', () => {
        test('should identify solution folders', () => {
            const folder = {
                typeGuid: PROJECT_TYPE_GUIDS.SOLUTION_FOLDER,
                name: 'Test',
                path: 'Test',
                guid: '{test}'
            };

            expect(SolutionXFileParser.isSolutionFolder(folder)).toBe(true);
        });

        test('should identify .NET projects', () => {
            const project = {
                typeGuid: PROJECT_TYPE_GUIDS.CSHARP_PROJECT,
                name: 'Test',
                path: 'Test/Test.csproj',
                guid: '{test}'
            };

            expect(SolutionXFileParser.isDotNetProject(project)).toBe(true);
        });
    });
});
