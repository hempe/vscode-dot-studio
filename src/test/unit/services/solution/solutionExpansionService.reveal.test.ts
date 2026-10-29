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

describe('SolutionExpansionService.revealDrop (after a drop)', () => {
    const apiPath = path.resolve('/repo/src/Api/Api.csproj');

    it('opens the solution folder a project was dropped onto and returns the project, remembered as expanded', async () => {
        const nodes = tree();
        const ctx = context();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, true, load);

        expect(revealed).toEqual([apiId]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(true);
        expect(ctx.saved).toEqual([srcFolderId]);
    });

    it('finds a moved solution folder and solution item by name and path: their ids changed with the parent', async () => {
        const nodes = tree();
        const src = find(nodes, srcFolderId)!;
        const sharedId = NodeIdService.generateSolutionFolderId('Shared', '/repo/App.slnx', 'guid-new', 'guid-src');
        const readmeId = NodeIdService.generateSolutionItemId('README.md', 'guid-src', path.resolve('/repo/README.md'));
        src.children!.push({ type: 'solutionFolder', name: 'Shared', nodeId: sharedId, children: [] }, { type: 'solutionItem', name: 'README.md', nodeId: readmeId });

        const revealed = await SolutionExpansionService.revealDrop({
            container: srcFolderId,
            nodes: [{ type: 'solutionItem', key: path.resolve('/repo/README.md') }, { type: 'solutionFolder', key: 'Shared' }],
        }, nodes, context(), true, load);

        expect(revealed).toEqual([readmeId, sharedId]);
    });

    it('loads the children of a collapsed folder a file was dropped onto, nested files included', async () => {
        const nodes = tree();
        const api = find(nodes, apiId)!;
        api.expanded = true;
        api.children = await load(api);

        const revealed = await SolutionExpansionService.revealDrop({
            container: pagesId,
            nodes: [{ type: 'file', key: path.resolve('/repo/src/Api/Pages/Index.cshtml.cs') }],
        }, nodes, context(), true, load);

        expect(revealed).toEqual([pageCodeId]);
        expect(find(nodes, pagesId)?.expanded).toBe(true);
    });

    it('opens the target even when the tree does not show the moved nodes yet, and returns none', async () => {
        const nodes = tree();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: path.resolve('/repo/Other/Other.csproj') }] }, nodes, context(), true, load);

        expect(revealed).toEqual([]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(true);
    });

    it('a container the tree does not have: nothing is opened or remembered', async () => {
        const nodes = tree();
        const ctx = context();
        const gone = NodeIdService.generateSolutionFolderId('Gone', '/repo/App.slnx', 'guid-gone');

        expect(await SolutionExpansionService.revealDrop({ container: gone, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, true, load)).toEqual([]);
        expect(ctx.saved).toEqual([]);
    });

    it('open false only looks: a target the user closed again stays closed', async () => {
        const nodes = tree();
        const ctx = context();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, false, load);

        expect(revealed).toEqual([apiId]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(false);
        expect(ctx.saved).toEqual([]);
    });
});
