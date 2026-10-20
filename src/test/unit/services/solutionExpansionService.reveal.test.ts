import * as path from 'path';
import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { ProjectNode } from '../../../types';
import { NodeIdString } from '../../../types/nodeId';

jest.mock('vscode', () => ({}), { virtual: true });

const context = () => {
    let saved: NodeIdString[] = [];
    return {
        get saved() { return saved; },
        workspaceState: {
            get: (_key: string, fallback: NodeIdString[]) => saved.length ? saved : fallback,
            update: (_key: string, value: NodeIdString[]) => { saved = value; },
        },
    } as any;
};

const solutionId = NodeIdService.generateSolutionId(path.resolve('/repo/App.slnx'));
const apiId = NodeIdService.generateProjectId(path.resolve('/repo/src/Api/Api.csproj'));
const testsId = NodeIdService.generateProjectId(path.resolve('/repo/test/Api.Tests/Api.Tests.csproj'));
const controllersId = NodeIdService.generateFolderId(path.resolve('/repo/src/Api/Controllers'));
const controllerId = NodeIdService.generateFileId(path.resolve('/repo/src/Api/Controllers/HomeController.cs'));
const pageId = NodeIdService.generateFileId(path.resolve('/repo/src/Api/Pages/Index.cshtml'));
const pageCodeId = NodeIdService.generateFileId(path.resolve('/repo/src/Api/Pages/Index.cshtml.cs'));
const pagesId = NodeIdService.generateFolderId(path.resolve('/repo/src/Api/Pages'));
const srcFolderId = NodeIdService.generateSolutionFolderId('src', '/repo/App.slnx', 'guid-src');

/** A tree as the Solution Explorer has it before anything below the projects was expanded */
const tree = (): ProjectNode[] => [{
    type: 'solution', name: 'App', nodeId: solutionId, expanded: true,
    children: [
        {
            type: 'solutionFolder', name: 'src', nodeId: srcFolderId, expanded: false,
            children: [{ type: 'project', name: 'Api', nodeId: apiId, hasChildren: true, expanded: false, children: [] }],
        },
        { type: 'project', name: 'Api.Tests', nodeId: testsId, hasChildren: true, expanded: false, children: [] },
    ],
}];

/** Children the projects and folders load when expanded */
const children: Record<string, ProjectNode[]> = {
    [apiId]: [
        { type: 'dependencies', name: 'Dependencies', nodeId: NodeIdService.generateDependenciesId(path.resolve('/repo/src/Api/Api.csproj')), hasChildren: true },
        { type: 'folder', name: 'Controllers', nodeId: controllersId, hasChildren: true },
        { type: 'folder', name: 'Pages', nodeId: pagesId, hasChildren: true },
    ],
    [controllersId]: [{ type: 'file', name: 'HomeController.cs', nodeId: controllerId }],
    [pagesId]: [{
        type: 'file', name: 'Index.cshtml', nodeId: pageId, hasChildren: true,
        children: [{ type: 'file', name: 'Index.cshtml.cs', nodeId: pageCodeId }],
    }],
};
const load = async (node: ProjectNode) => children[node.nodeId] ?? [];

const find = (nodes: ProjectNode[], nodeId: NodeIdString): ProjectNode | undefined => {
    for (const node of nodes) {
        if (node.nodeId === nodeId) return node;
        const found = node.children && find(node.children, nodeId);
        if (found) return found;
    }
    return undefined;
};

describe('SolutionExpansionService.revealPath (Sync with Active Document)', () => {
    it('expands the solution folder, project and folders down to the file', async () => {
        const nodes = tree();
        const ctx = context();

        const revealed = await SolutionExpansionService.revealPath(path.resolve('/repo/src/Api/Controllers/HomeController.cs'), nodes, ctx, load);

        expect(revealed).toBe(controllerId);
        expect([srcFolderId, apiId, controllersId].map(id => find(nodes, id)?.expanded)).toEqual([true, true, true]);
        expect(find(nodes, pagesId)?.expanded).toBeFalsy();
        expect(find(nodes, testsId)?.expanded).toBe(false);
        // Remembered like expanding by hand
        expect(ctx.saved).toEqual(expect.arrayContaining([srcFolderId, apiId, controllersId]));
    });

    it('expands the parent of a nested file', async () => {
        const nodes = tree();

        const revealed = await SolutionExpansionService.revealPath(path.resolve('/repo/src/Api/Pages/Index.cshtml.cs'), nodes, context(), load);

        expect(revealed).toBe(pageCodeId);
        expect(find(nodes, pageId)?.expanded).toBe(true);
    });

    it('finds nothing for files outside the solution', async () => {
        const nodes = tree();

        expect(await SolutionExpansionService.revealPath(path.resolve('/elsewhere/Notes.md'), nodes, context(), load)).toBeUndefined();
        expect(find(nodes, apiId)?.expanded).toBe(false);
    });
});

describe('SolutionExpansionService.collapseAll', () => {
    it('collapses everything but the solution, like Visual Studio', async () => {
        const nodes = tree();
        const ctx = context();
        await SolutionExpansionService.revealPath(path.resolve('/repo/src/Api/Controllers/HomeController.cs'), nodes, ctx, load);

        SolutionExpansionService.collapseAll(nodes, ctx);

        expect([solutionId, srcFolderId, apiId, controllersId].map(id => find(nodes, id)?.expanded)).toEqual([true, false, false, false]);
        expect(ctx.saved).toEqual([solutionId]);
    });
});
