import { SolutionManager } from './solutionManager';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');
jest.mock('vscode', () => ({}), { virtual: true });

const mockExec = exec as jest.MockedFunction<typeof exec>;
const execAsync = promisify(mockExec);

describe('SolutionManager', () => {
  const testWorkspaceRoot = '/test/workspace';
  const testSolutionPath = '/test/workspace/TestSolution.sln';
  let solutionManager: SolutionManager;

  beforeEach(() => {
    solutionManager = new SolutionManager(testWorkspaceRoot);
    jest.clearAllMocks();
  });

  describe('listProjects', () => {
    it('should parse dotnet sln list output correctly', async () => {
      const mockOutput = `Project(s)
----------
src/WebApp/WebApp.csproj
src/ClassLibrary/ClassLibrary.csproj
tests/Tests.csproj`;

      (execAsync as jest.MockedFunction<typeof execAsync>).mockResolvedValue({
        stdout: mockOutput,
        stderr: ''
      });

      const projects = await solutionManager.listProjects(testSolutionPath);

      expect(projects).toHaveLength(3);
      expect(projects[0]).toEqual({
        name: 'WebApp',
        path: expect.stringContaining('WebApp.csproj'),
        relativePath: 'src/WebApp/WebApp.csproj'
      });
      expect(projects[1].name).toBe('ClassLibrary');
      expect(projects[2].name).toBe('Tests');
    });

    it('should handle empty solution', async () => {
      const mockOutput = `Project(s)
----------`;

      (execAsync as jest.MockedFunction<typeof execAsync>).mockResolvedValue({
        stdout: mockOutput,
        stderr: ''
      });

      const projects = await solutionManager.listProjects(testSolutionPath);
      expect(projects).toHaveLength(0);
    });

    it('should handle command errors gracefully', async () => {
      (execAsync as jest.MockedFunction<typeof execAsync>).mockRejectedValue(new Error('Command failed'));

      const projects = await solutionManager.listProjects(testSolutionPath);
      expect(projects).toHaveLength(0);
    });

    it('should filter out non-project files', async () => {
      const mockOutput = `Project(s)
----------
src/WebApp/WebApp.csproj
src/SolutionFolder/SolutionItems.txt
tests/Tests.vbproj
lib/Library.fsproj`;

      (execAsync as jest.MockedFunction<typeof execAsync>).mockResolvedValue({
        stdout: mockOutput,
        stderr: ''
      });

      const projects = await solutionManager.listProjects(testSolutionPath);

      expect(projects).toHaveLength(3);
      expect(projects.map(p => p.name)).toEqual(['WebApp', 'Tests', 'Library']);
    });
  });
});