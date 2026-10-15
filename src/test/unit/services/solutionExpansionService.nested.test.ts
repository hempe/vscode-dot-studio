jest.mock('vscode', () => ({}), { virtual: true });

const state = new Map<string, unknown>();
jest.mock('../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => ({}) } }));

import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { ProjectNode } from '../../../types';

describe('expanding a file with nested files (Index.cshtml > Index.cshtml.cs)', () => {
    it('keeps the nested files, which come with their parent', async () => {
        const page = NodeIdService.generateFileId('/repo/Web/Pages/Index.cshtml');
        const codeBehind = NodeIdService.generateFileId('/repo/Web/Pages/Index.cshtml.cs');
        const tree: ProjectNode[] = [{
            type: 'file', name: 'Index.cshtml', nodeId: page, hasChildren: true, expanded: false,
            children: [{ type: 'file', name: 'Index.cshtml.cs', nodeId: codeBehind }],
        }];
        const context = { workspaceState: { get: (k: string, d: unknown) => state.get(k) ?? d, update: async (k: string, v: unknown) => { state.set(k, v); } } } as any;

        await SolutionExpansionService.handleExpandNode(page, tree, async () => { }, context);

        expect(tree[0].expanded).toBe(true);
        expect(tree[0].children?.map(child => child.name)).toEqual(['Index.cshtml.cs']);
        expect(tree[0].hasChildren).toBe(true);
    });
});
