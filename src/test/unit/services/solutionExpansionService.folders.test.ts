import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { ProjectNode } from '../../../types';
import { NodeIdString } from '../../../types/nodeId';

jest.mock('vscode', () => ({}), { virtual: true });

const node = (type: string, name: string, expanded: boolean, children: ProjectNode[] = []): ProjectNode =>
    ({ type, name, nodeId: `${type}:${name}:${Math.random()}` as NodeIdString, expanded, children } as unknown as ProjectNode);

describe('moving an open solution folder keeps it and the folders in it open (.slnx folders without an Id)', () => {
    const tree = () => [node('solution', 'S', true, [
        node('solutionFolder', 'src', true, [node('solutionFolder', 'libs', true, [node('solutionFolder', 'deep', false)]), node('solutionFolder', 'tools', true)]),
        node('solutionFolder', 'docs', true),
    ])];

    it('finds the name path of a folder and the open folders', () => {
        const nodes = tree();
        const libs = nodes[0].children![0].children![0];
        expect(SolutionExpansionService.solutionFolderPath(libs.nodeId, nodes)).toEqual(['src', 'libs']);
        expect(SolutionExpansionService.solutionFolderPath(nodes[0].nodeId, nodes)).toEqual([]);
        expect(SolutionExpansionService.openSolutionFolderPaths(nodes)).toEqual([['src'], ['src', 'libs'], ['src', 'tools'], ['docs']]);
    });

    it('moves the open paths of the folder and below it into the target, and leaves the others', () => {
        const open = [['src'], ['src', 'libs'], ['src', 'tools'], ['docs']];
        expect(SolutionExpansionService.pathsAfterMove(open, ['src', 'libs'], ['docs'])).toEqual([['docs', 'libs']]);
        expect(SolutionExpansionService.pathsAfterMove(open, ['src'], ['docs'])).toEqual([['docs', 'src'], ['docs', 'src', 'libs'], ['docs', 'src', 'tools']]);
        expect(SolutionExpansionService.pathsAfterMove(open, ['src', 'libs'], [])).toEqual([['libs']]);
    });

    it('opens the folders of the rebuilt tree by their names and remembers them, reporting any it did not find', () => {
        const nodes = tree();
        const stored = new Set<NodeIdString>();
        const context = { workspaceState: { get: () => [...stored], update: (_k: string, v: NodeIdString[]) => { stored.clear(); v.forEach(id => stored.add(id)); return Promise.resolve(); } } } as never;
        const docs = nodes[0].children![1];
        const libs = nodes[0].children![0].children![0];
        libs.expanded = false;

        expect(SolutionExpansionService.openSolutionFolders([['src', 'libs']], nodes, context)).toBe(true);
        expect(libs.expanded).toBe(true);
        expect(stored.has(libs.nodeId)).toBe(true);
        expect(SolutionExpansionService.openSolutionFolders([['docs', 'libs']], nodes, context)).toBe(false);
        expect(docs.expanded).toBe(true);
    });
});
