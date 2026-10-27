import { mergeTreeData } from '../../../../webview/solution-view/hooks/useVsCodeApi';
import { NodeIdString } from '../../../../types/nodeId';
import { ProjectNode } from '../../../../types';

const tree = (startup: 'Web' | 'Worker'): ProjectNode[] => [{
    type: 'solution', name: 'App', nodeId: 'solution' as NodeIdString, expanded: true,
    children: (['Web', 'Worker'] as const).map(name => ({
        type: 'project' as const,
        name,
        nodeId: name as NodeIdString,
        isStartupProject: name === startup,
        contextValue: name === startup ? 'startup' : 'executable',
    })),
}];

describe('mergeTreeData', () => {
    it('takes over a new startup project (bold name, its context menu)', () => {
        const before = { projects: tree('Web') };

        const merged = mergeTreeData(before, { projects: tree('Worker') });

        const [web, worker] = merged.projects[0].children!;
        expect([web.isStartupProject, web.contextValue]).toEqual([false, 'executable']);
        expect([worker.isStartupProject, worker.contextValue]).toEqual([true, 'startup']);
    });

    it('keeps the node objects that did not change, so React does not re-render them', () => {
        const before = { projects: tree('Web') };

        const merged = mergeTreeData(before, { projects: tree('Web') });

        expect(merged.projects[0].children![1]).toBe(before.projects[0].children![1]);
    });
});
