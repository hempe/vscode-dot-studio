import { canDrop, dropNodeIndex, DropNode, isDraggable } from '../../../core/dropRules';
import { ProjectNode } from '../../../types';
import { NodeIdString } from '../../../types/nodeId';

const node = (type: ProjectNode['type'], name: string, children?: ProjectNode[], extra: Partial<ProjectNode> = {}): ProjectNode =>
    ({ type, name, nodeId: name as NodeIdString, children, ...extra });

const tree: ProjectNode[] = [node('solution', 'App', [
    node('solutionFolder', 'Libs', [
        node('solutionFolder', 'Inner'),
        node('project', 'Lib', [
            node('folder', 'Models', [
                node('file', 'Order.cs', [node('file', 'Order.Designer.cs')]),
            ]),
            node('file', 'A.cs'),
            node('file', 'Linked.cs', undefined, { itemState: 'linked' }),
            node('file', 'Old.cs', undefined, { itemState: 'excluded' }),
        ]),
        node('solutionItem', 'README.md'),
    ]),
    node('solutionFolder', 'Tools'),
    node('project', 'Api', [
        node('dependencies', 'Dependencies', [node('dependencyCategory', 'Packages', [node('dependency', 'Serilog')])]),
        node('folder', 'Controllers', [node('file', 'C.cs')]),
        node('generatedFile', 'Gen.g.cs'),
    ]),
    node('project', 'Unloaded', undefined, { isUnloaded: true }),
])];

const index = dropNodeIndex(tree);
const n = (name: string): DropNode => index.get(name as NodeIdString)!;
const drop = (dragged: string[], target: string, copyKey = false) => {
    const verdict = canDrop(dragged.map(n), n(target), copyKey);
    return { nodes: verdict.nodes.map(x => x.nodeId), into: verdict.container?.nodeId, effect: verdict.effect };
};

describe('dropRules', () => {
    test('the index lists every node with its ancestors, nearest first', () => {
        expect(n('Order.Designer.cs').ancestors.map(a => a.nodeId)).toEqual(['Order.cs', 'Models', 'Lib', 'Libs', 'App']);
        expect(n('App').ancestors).toEqual([]);
    });

    describe('the table of the spec', () => {
        test('files and folders go into folders and projects, onto a file means its folder; Ctrl copies', () => {
            expect(drop(['A.cs'], 'Controllers')).toEqual({ nodes: ['A.cs'], into: 'Controllers', effect: 'move' });
            expect(drop(['A.cs'], 'Api')).toEqual({ nodes: ['A.cs'], into: 'Api', effect: 'move' });
            expect(drop(['A.cs'], 'C.cs')).toEqual({ nodes: ['A.cs'], into: 'Controllers', effect: 'move' });
            expect(drop(['Models'], 'Controllers', true)).toEqual({ nodes: ['Models'], into: 'Controllers', effect: 'copy' });
            expect(drop(['Old.cs'], 'Api').nodes).toEqual(['Old.cs']);
        });

        test('projects go into solution folders and the solution root; Ctrl still moves', () => {
            expect(drop(['Api'], 'Tools', true)).toEqual({ nodes: ['Api'], into: 'Tools', effect: 'move' });
            expect(drop(['Lib'], 'App')).toEqual({ nodes: ['Lib'], into: 'App', effect: 'move' });
            expect(drop(['Api'], 'Controllers').nodes).toEqual([]);
            expect(drop(['Api'], 'Lib').nodes).toEqual([]);
        });

        test('solution folders go into solution folders and the root, not into themselves or their descendants', () => {
            expect(drop(['Inner'], 'Tools').nodes).toEqual(['Inner']);
            expect(drop(['Inner'], 'App').nodes).toEqual(['Inner']);
            expect(drop(['Libs'], 'Libs').nodes).toEqual([]);
            expect(drop(['Libs'], 'Inner').nodes).toEqual([]);
        });

        test('solution items go into solution folders only', () => {
            expect(drop(['README.md'], 'Tools')).toEqual({ nodes: ['README.md'], into: 'Tools', effect: 'move' });
            expect(drop(['README.md'], 'App').nodes).toEqual([]);
            expect(drop(['README.md'], 'Api').nodes).toEqual([]);
        });

        test('everything else is not a target', () => {
            for (const target of ['Dependencies', 'Packages', 'Serilog', 'Gen.g.cs', 'Inner', 'README.md', 'Linked.cs', 'Unloaded']) {
                expect(drop(['A.cs'], target).nodes).toEqual([]);
            }
        });
    });

    test('nodes without a move are not draggable', () => {
        for (const name of ['App', 'Dependencies', 'Packages', 'Serilog', 'Gen.g.cs', 'Linked.cs', 'Unloaded']) {
            expect(isDraggable(n(name))).toBe(false);
        }
        expect(isDraggable({ type: 'file', isTemporary: true })).toBe(false);
        for (const name of ['A.cs', 'Models', 'Lib', 'Libs', 'README.md', 'Old.cs']) {
            expect(isDraggable(n(name))).toBe(true);
        }
    });

    test('of several dragged nodes only those that fit go; if none fit there is no drop', () => {
        expect(drop(['A.cs', 'Api'], 'Tools').nodes).toEqual(['Api']);
        expect(drop(['A.cs', 'Api'], 'Controllers').nodes).toEqual(['A.cs']);
        expect(drop(['Dependencies', 'Gen.g.cs'], 'Controllers')).toEqual({ nodes: [], into: undefined, effect: 'move' });
    });

    test('Ctrl copies only when what goes is files and folders', () => {
        expect(drop(['A.cs', 'Api'], 'Controllers', true).effect).toBe('copy');
        expect(drop(['A.cs', 'Api'], 'Tools', true).effect).toBe('move');
    });

    test('a node under another dragged node goes along with it', () => {
        expect(drop(['Models', 'Order.cs'], 'Controllers').nodes).toEqual(['Models']);
    });

    test('a folder cannot go onto itself or anything inside it', () => {
        expect(drop(['Models'], 'Models').nodes).toEqual([]);
        expect(drop(['Models'], 'Order.Designer.cs').nodes).toEqual([]);
    });

    test('a node dropped where it already is does nothing', () => {
        expect(drop(['A.cs'], 'Lib').nodes).toEqual([]);
        expect(drop(['A.cs'], 'Old.cs').nodes).toEqual([]);
        expect(drop(['Order.Designer.cs'], 'Order.cs').nodes).toEqual([]);
        expect(drop(['Lib'], 'Libs').nodes).toEqual([]);
        expect(drop(['README.md'], 'Libs').nodes).toEqual([]);
        expect(drop(['Libs'], 'App').nodes).toEqual([]);
    });
});

describe('projects onto Dependencies: a project reference', () => {
    const refTree: ProjectNode[] = [node('solution', 'S', [
        node('project', 'Web', [
            node('dependencies', 'Web.Dependencies', [
                node('dependencyCategory', 'Web.Projects', undefined, { contextValue: 'projects' }),
                node('dependencyCategory', 'Web.Packages', undefined, { contextValue: 'packages' }),
            ]),
            node('file', 'Program.cs'),
        ]),
        node('project', 'Lib'),
        node('project', 'Gone', undefined, { isUnloaded: true }),
    ])];
    const refs = dropNodeIndex(refTree);
    const get = (name: string) => refs.get(name as NodeIdString)!;

    test('another project onto Dependencies or onto its Projects category links, also with the copy key', () => {
        expect(canDrop([get('Lib')], get('Web.Dependencies'))).toEqual({ nodes: [get('Lib')], container: get('Web.Dependencies'), effect: 'link' });
        expect(canDrop([get('Lib')], get('Web.Projects'), true).effect).toBe('link');
    });

    test('not the project onto its own Dependencies, not onto Packages, not files, not an unloaded project', () => {
        expect(canDrop([get('Web')], get('Web.Dependencies')).nodes).toEqual([]);
        expect(canDrop([get('Lib')], get('Web.Packages')).nodes).toEqual([]);
        expect(canDrop([get('Program.cs')], get('Web.Dependencies')).nodes).toEqual([]);
        expect(canDrop([get('Gone')], get('Web.Dependencies')).nodes).toEqual([]);
    });

    test('with the project itself among several, only the others link', () => {
        expect(canDrop([get('Web'), get('Lib')], get('Web.Dependencies')).nodes.map(n => n.nodeId)).toEqual(['Lib']);
    });
});
