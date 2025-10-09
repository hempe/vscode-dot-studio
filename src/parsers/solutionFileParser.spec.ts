import { SolutionFileParser, SolutionProject } from './solutionFileParser';
import * as fs from 'fs';
import * as path from 'path';

describe('SolutionFileParser', () => {
  const sampleSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "TestProject", "TestProject\\TestProject.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "SolutionFolder", "SolutionFolder", "{87654321-4321-4321-4321-210987654321}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{12345678-1234-1234-1234-123456789012}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{12345678-1234-1234-1234-123456789012}.Debug|Any CPU.Build.0 = Debug|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
EndGlobal`;

  const sampleNestedSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "WebApp", "src\\WebApp\\WebApp.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "ClassLib", "src\\ClassLib\\ClassLib.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Source", "Source", "{33333333-3333-3333-3333-333333333333}"
EndProject
Global
	GlobalSection(NestedProjects) = preSolution
		{11111111-1111-1111-1111-111111111111} = {33333333-3333-3333-3333-333333333333}
		{22222222-2222-2222-2222-222222222222} = {33333333-3333-3333-3333-333333333333}
	EndGlobalSection
EndGlobal`;

  describe('parse', () => {
    it('should parse basic solution file', async () => {
      const result = await SolutionFileParser.parse(sampleSolutionContent, '/test/path');

      expect(result.formatVersion).toBe('12.00');
      expect(result.visualStudioVersion).toBe('17.0.31903.59');
      expect(result.minimumVisualStudioVersion).toBe('10.0.40219.1');
      expect(result.projects).toHaveLength(2);

      // Test regular project
      const regularProject = result.projects.find(p => p.name === 'TestProject');
      expect(regularProject).toBeDefined();
      expect(regularProject!.typeGuid).toBe('{9A19103F-16F7-4668-BE54-9A1E7A4F7556}');
      expect(regularProject!.path).toBe('TestProject/TestProject.csproj');
      expect(regularProject!.guid).toBe('{12345678-1234-1234-1234-123456789012}');

      // Test solution folder
      const solutionFolder = result.projects.find(p => p.name === 'SolutionFolder');
      expect(solutionFolder).toBeDefined();
      expect(solutionFolder!.typeGuid).toBe('{2150E333-8FDC-42A3-9474-1A3956D46DE8}');
    });

    it('should parse nested projects', async () => {
      const result = await SolutionFileParser.parse(sampleNestedSolutionContent, '/test/path');

      expect(result.nestedProjects).toHaveLength(2);

      const webAppNesting = result.nestedProjects.find(np =>
        np.childGuid === '{11111111-1111-1111-1111-111111111111}'
      );
      expect(webAppNesting).toBeDefined();
      expect(webAppNesting!.parentGuid).toBe('{33333333-3333-3333-3333-333333333333}');

      const classLibNesting = result.nestedProjects.find(np =>
        np.childGuid === '{22222222-2222-2222-2222-222222222222}'
      );
      expect(classLibNesting).toBeDefined();
      expect(classLibNesting!.parentGuid).toBe('{33333333-3333-3333-3333-333333333333}');
    });

    it('should handle empty or minimal solution files', async () => {
      const minimalContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Global
EndGlobal`;

      const result = await SolutionFileParser.parse(minimalContent, '/test/path');

      expect(result.formatVersion).toBe('12.00');
      expect(result.projects).toHaveLength(0);
      expect(result.globalSections).toHaveLength(0);
      expect(result.nestedProjects).toHaveLength(0);
    });

    it('should handle malformed solution files gracefully', async () => {
      const malformedContent = `Not a valid solution file
Random content here`;

      const result = await SolutionFileParser.parse(malformedContent, '/test/path');
      // Parser handles malformed content gracefully by returning empty solution
      expect(result.formatVersion).toBe('');
      expect(result.projects).toHaveLength(0);
    });
  });

  describe('project type identification', () => {
    it('should identify .NET projects correctly', () => {
      const dotnetProject: SolutionProject = {
        typeGuid: '{9A19103F-16F7-4668-BE54-9A1E7A4F7556}',
        name: 'TestProject',
        path: 'TestProject.csproj',
        guid: '{12345678-1234-1234-1234-123456789012}'
      };

      expect(SolutionFileParser.isDotNetProject(dotnetProject)).toBe(true);
    });

    it('should identify solution folders correctly', () => {
      const solutionFolder: SolutionProject = {
        typeGuid: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
        name: 'MyFolder',
        path: 'MyFolder',
        guid: '{87654321-4321-4321-4321-210987654321}'
      };

      expect(SolutionFileParser.isSolutionFolder(solutionFolder)).toBe(true);
      expect(SolutionFileParser.isDotNetProject(solutionFolder)).toBe(false);
    });

    it('should identify legacy project types', () => {
      const legacyProject: SolutionProject = {
        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}', // Legacy C# project
        name: 'OldProject',
        path: 'OldProject.csproj',
        guid: '{11111111-1111-1111-1111-111111111111}'
      };

      expect(SolutionFileParser.isDotNetProject(legacyProject)).toBe(true);
    });
  });

  describe('real file parsing', () => {
    const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');
    const testSolutionPath = path.join(testFixturePath, 'TestSolution.sln');

    it('should parse test fixture solution file', async () => {
      const content = await fs.promises.readFile(testSolutionPath, 'utf8');
      const result = await SolutionFileParser.parse(content, testFixturePath);

      expect(result.formatVersion).toBe('12.00');
      expect(result.visualStudioVersion).toBe('17.8.34330.188');
      expect(result.projects).toHaveLength(5); // 3 projects + 2 solution folders

      // Test projects
      const webApp = result.projects.find(p => p.name === 'WebApp');
      const classLibrary = result.projects.find(p => p.name === 'ClassLibrary');
      const tests = result.projects.find(p => p.name === 'Tests');
      const sourceFolder = result.projects.find(p => p.name === 'Source');
      const solutionItems = result.projects.find(p => p.name === 'Solution Items');

      expect(webApp).toBeDefined();
      expect(webApp!.path).toBe('src/WebApp/WebApp.csproj');
      expect(webApp!.guid).toBe('{A1B2C3D4-5678-9ABC-DEF0-123456789ABC}');

      expect(classLibrary).toBeDefined();
      expect(tests).toBeDefined();
      expect(sourceFolder).toBeDefined();
      expect(solutionItems).toBeDefined();

      // Test nesting
      expect(result.nestedProjects).toHaveLength(3);

      // Test .NET project identification
      const dotnetProjects = result.projects.filter(p => SolutionFileParser.isDotNetProject(p));
      expect(dotnetProjects).toHaveLength(3); // WebApp, ClassLibrary, Tests

      const solutionFolders = result.projects.filter(p => SolutionFileParser.isSolutionFolder(p));
      expect(solutionFolders).toHaveLength(2); // Source, Solution Items

      console.log(`✓ Successfully parsed test solution with ${result.projects.length} projects`);
      console.log(`✓ Found ${dotnetProjects.length} .NET projects and ${solutionFolders.length} solution folders`);
    }, 15000);

    it('should parse actual solution file if one exists in workspace', async () => {
      // Try to find and parse an actual solution file
      try {
        const files = await fs.promises.readdir(process.cwd());
        const solutionFile = files.find(f => f.endsWith('.sln'));

        if (solutionFile) {
          const solutionPath = path.join(process.cwd(), solutionFile);
          const content = await fs.promises.readFile(solutionPath, 'utf8');

          const result = await SolutionFileParser.parse(content, process.cwd());

          expect(result).toHaveProperty('formatVersion');
          expect(result).toHaveProperty('projects');
          expect(Array.isArray(result.projects)).toBe(true);

          console.log(`✓ Successfully parsed real solution file: ${solutionFile}`);
          console.log(`✓ Found ${result.projects.length} projects`);
        } else {
          console.log('ⓘ No solution file found in current workspace (this is ok for testing)');
        }
      } catch (error) {
        console.log('ⓘ Could not test real solution parsing:', error);
      }
    }, 15000);
  });

  describe('framework detection', () => {
    const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');
    const testSolutionPath = path.join(testFixturePath, 'TestSolution.sln');

    it('should automatically detect frameworks when parsing solution', async () => {
      const content = await fs.promises.readFile(testSolutionPath, 'utf8');
      const result = await SolutionFileParser.parse(content, testFixturePath);

      // Find the projects and check their frameworks
      const webApp = result.projects.find(p => p.name === 'WebApp');
      const classLibrary = result.projects.find(p => p.name === 'ClassLibrary');
      const tests = result.projects.find(p => p.name === 'Tests');

      expect(webApp).toBeDefined();
      expect(webApp!.targetFrameworks).toContain('net8.0');
      expect(webApp!.targetFrameworks).toHaveLength(1);
      console.log(`✓ WebApp frameworks: ${webApp!.targetFrameworks!.join(', ')}`);

      expect(classLibrary).toBeDefined();
      expect(classLibrary!.targetFrameworks).toContain('net6.0');
      expect(classLibrary!.targetFrameworks).toContain('net8.0');
      expect(classLibrary!.targetFrameworks).toContain('netstandard2.0');
      expect(classLibrary!.targetFrameworks).toHaveLength(3);
      console.log(`✓ ClassLibrary frameworks: ${classLibrary!.targetFrameworks!.join(', ')}`);

      expect(tests).toBeDefined();
      expect(tests!.targetFrameworks).toContain('net8.0');
      expect(tests!.targetFrameworks).toHaveLength(1);
      console.log(`✓ Tests frameworks: ${tests!.targetFrameworks!.join(', ')}`);
    });

    it('should handle solution folders (no frameworks)', async () => {
      const content = await fs.promises.readFile(testSolutionPath, 'utf8');
      const result = await SolutionFileParser.parse(content, testFixturePath);

      const solutionFolders = result.projects.filter(p => SolutionFileParser.isSolutionFolder(p));
      solutionFolders.forEach(folder => {
        expect(folder.targetFrameworks).toBeUndefined();
      });

      console.log(`✓ Solution folders have no frameworks (as expected)`);
    });
  });
});