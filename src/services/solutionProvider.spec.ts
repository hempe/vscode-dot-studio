import { SolutionProvider } from './solutionProvider';

// Mock VS Code completely
jest.mock('vscode', () => ({
  TreeDataProvider: class {},
  EventEmitter: class {
    fire() {}
    get event() { return () => {}; }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  }
}), { virtual: true });

jest.mock('./solutionManager');
jest.mock('../parsers/projectFileParser');
jest.mock('./fileNesting');

describe('SolutionProvider', () => {
  const testWorkspaceRoot = '/test/workspace';
  let solutionProvider: SolutionProvider;

  beforeEach(() => {
    solutionProvider = new SolutionProvider(testWorkspaceRoot);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with workspace root', () => {
      expect(solutionProvider).toBeDefined();
    });

    it('should initialize without workspace root', () => {
      const provider = new SolutionProvider();
      expect(provider).toBeDefined();
    });
  });

  describe('refresh', () => {
    it('should refresh tree data', () => {
      expect(() => solutionProvider.refresh()).not.toThrow();
    });
  });

  describe('setFrameworkFilter', () => {
    it('should set framework filter and refresh', () => {
      expect(() => solutionProvider.setFrameworkFilter('net8.0')).not.toThrow();
      expect(() => solutionProvider.setFrameworkFilter()).not.toThrow();
    });
  });
});