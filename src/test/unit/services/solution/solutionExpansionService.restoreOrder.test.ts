// Open folders come back with their children after the tree is rebuilt (the roadmap's "open rows without children")
import { SolutionExpansionService } from '../../../../services/solution/solutionExpansionService';
import { NodeIdService } from '../../../../services/solution/nodeIdService';
import { ProjectNode } from '../../../../types';

jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../../../../services/diagnostics/analyzerNodes', () => ({ analyzerChildren: async () => undefined }));
jest.mock('../../../../services/nuget/packageNodes', () => ({ packageChildren: () => undefined }));
jest.mock('../../../../services/grpc/grpcNodes', () => ({ grpcChildren: () => undefined }));

const projectPath = '/ws/src/Web/Web.csproj';
const wwwroot = '/ws/src/Web/wwwroot';
const css = '/ws/src/Web/wwwroot/css';
const projectId = NodeIdService.generateProjectId(projectPath);
const wwwrootId = NodeIdService.generateFolderId(wwwroot, projectPath);
const cssId = NodeIdService.generateFolderId(css, projectPath);

jest.mock('../../../../services/solution/solutionService', () => {
    const child = (type: string, name: string, nodeId: string, hasChildren = false) => ({ type, name, nodeId, hasChildren });
    const { NodeIdService: Ids } = jest.requireActual('../../../../services/solution/nodeIdService');
    const project = {
        getRootChildren: async () => [child('folder', 'wwwroot', Ids.generateFolderId('/ws/src/Web/wwwroot', '/ws/src/Web/Web.csproj'), true), child('file', 'Program.cs', Ids.generateFileId('/ws/src/Web/Program.cs', '/ws/src/Web/Web.csproj'))],
        getFolderChildren: async (folder: string) => folder === '/ws/src/Web/wwwroot'
            ? [child('folder', 'css', Ids.generateFolderId('/ws/src/Web/wwwroot/css', '/ws/src/Web/Web.csproj'), true), child('file', 'site.js', Ids.generateFileId('/ws/src/Web/wwwroot/site.js', '/ws/src/Web/Web.csproj'))]
            : [child('file', 'site.css', Ids.generateFileId('/ws/src/Web/wwwroot/css/site.css', '/ws/src/Web/Web.csproj'))],
        createFolderWatcher: () => undefined,
    };
    return { SolutionService: { getActiveSolution: () => ({ getProject: () => project }) } };
});

const names = (nodes: ProjectNode[] | undefined): string[] => (nodes ?? []).map(n => n.name);
const find = (nodes: ProjectNode[], id: string): ProjectNode | undefined => {
    for (const node of nodes) {
        const found = node.nodeId === id ? node : find(node.children ?? [], id);
        if (found) { return found; }
    }
    return undefined;
};

describe('restoreExpansionStates: parents before their children', () => {
    it('a project (its .csproj path is longer than its folders\' paths) loads before the open folders in it', async () => {
        const context = { workspaceState: { get: () => [wwwrootId, cssId, projectId], update: () => Promise.resolve() } } as any;
        const tree: ProjectNode[] = [{ type: 'solution', name: 'S', nodeId: NodeIdService.generateSolutionId('/ws/S.sln'), expanded: true,
            children: [{ type: 'project', name: 'Web', nodeId: projectId, expanded: false }] }];

        await SolutionExpansionService.restoreExpansionStates(tree, context);

        const web = find(tree, wwwrootId);
        expect(web?.expanded).toBe(true);
        expect(names(web?.children)).toEqual(['css', 'site.js']);
        expect(find(tree, cssId)?.expanded).toBe(true);
        expect(names(find(tree, cssId)?.children)).toEqual(['site.css']);
    });
});
