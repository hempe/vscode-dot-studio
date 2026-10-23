import * as fs from 'fs';
import * as path from 'path';
import { act, createEvent, fireEvent, render } from '@testing-library/react';

const sent: any[] = [];
jest.mock('../../../../../webview/nuget-view/shared', () => ({
    ...jest.requireActual('../../../../../webview/nuget-view/shared'),
    sendToBackend: (message: unknown) => sent.push(message),
}));

import { DRAG_DATA_TYPE, SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const node = (type: ProjectNode['type'], name: string, children?: ProjectNode[], extra: Partial<ProjectNode> = {}): ProjectNode =>
    ({ type, name, nodeId: name as NodeIdString, children, ...extra });

const projects: ProjectNode[] = [node('solution', 'App', [
    node('solutionFolder', 'Tools', []),
    node('project', 'Api', [
        node('dependencies', 'Dependencies', undefined, { hasChildren: true }),
        node('folder', 'Controllers', [node('file', 'C.cs')], { expanded: true }),
        node('folder', 'Models', undefined, { hasChildren: true }),
        node('file', 'A.cs'),
        node('file', 'B.cs'),
    ], { expanded: true }),
], { expanded: true })];

type Keys = { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

describe('SolutionTree drag & drop', () => {
    beforeEach(() => { sent.length = 0; });

    const setup = () => {
        const onExpandNode = jest.fn();
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} onExpandNode={onExpandNode} />);
        const row = (name: string) => [...container.querySelectorAll('.tree-node')].find(el => el.textContent === name)!;
        const data: Record<string, string> = {};
        const transfer = {
            data,
            setData: (type: string, value: string) => { data[type] = value; },
            getData: (type: string) => data[type] ?? '',
            effectAllowed: 'uninitialized',
            dropEffect: 'none',
            types: [] as string[],
        };
        const drag = (type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd', name: string, keys: boolean | Keys = false) => {
            const target = row(name);
            const event = createEvent[type](target, { dataTransfer: transfer });
            // jsdom has no DragEvent: the modifier keys are set by hand
            const { ctrlKey = false, metaKey = false, altKey = false } = typeof keys === 'boolean' ? { ctrlKey: keys } : keys;
            Object.defineProperty(event, 'ctrlKey', { value: ctrlKey });
            Object.defineProperty(event, 'metaKey', { value: metaKey });
            Object.defineProperty(event, 'altKey', { value: altKey });
            fireEvent(target, event);
            return event;
        };
        const moves = () => sent.filter(m => m.type === 'moveNodes').map(m => m.payload);
        const highlighted = () => [...container.querySelectorAll('.tree-node.drop-target')].map(el => el.textContent);
        return { row, drag, transfer, moves, highlighted, onExpandNode };
    };

    it('rows with a move are draggable, the others are not', () => {
        const { row } = setup();
        expect(row('A.cs').getAttribute('draggable')).toBe('true');
        expect(row('Api').getAttribute('draggable')).toBe('true');
        expect(row('Dependencies').getAttribute('draggable')).toBe('false');
        expect(row('App').getAttribute('draggable')).toBe('false');
    });

    it('drags the selected nodes, or only the row when it is not selected', () => {
        const { row, drag, transfer, moves } = setup();
        fireEvent.click(row('A.cs'), { ctrlKey: true });
        fireEvent.click(row('B.cs'), { ctrlKey: true });

        drag('dragStart', 'A.cs');
        expect(transfer.effectAllowed).toBe('copyMove');
        expect(JSON.parse(transfer.data[DRAG_DATA_TYPE])).toEqual(['A.cs', 'B.cs']);
        drag('dragOver', 'Controllers');
        drag('drop', 'Controllers');
        expect(moves()).toEqual([{ nodeIds: ['A.cs', 'B.cs'], targetNodeId: 'Controllers', copy: false }]);

        drag('dragStart', 'C.cs');
        drag('drop', 'Api');
        expect(moves()[1]).toEqual({ nodeIds: ['C.cs'], targetNodeId: 'Api', copy: false });
    });

    it('highlights a valid target and takes the drop; an invalid one keeps the not-allowed cursor', () => {
        const { drag, transfer, highlighted, moves } = setup();
        drag('dragStart', 'A.cs');
        const valid = drag('dragOver', 'Controllers');
        expect(valid.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('move');
        expect(highlighted()).toEqual(['Controllers']);

        const invalid = drag('dragOver', 'Tools');
        expect(invalid.defaultPrevented).toBe(false);
        expect(highlighted()).toEqual([]);
        drag('drop', 'Tools');
        expect(moves()).toEqual([]);
    });

    it('the highlight goes away when the drag ends', () => {
        const { drag, highlighted } = setup();
        drag('dragStart', 'A.cs');
        drag('dragOver', 'Controllers');
        expect(highlighted()).toEqual(['Controllers']);
        drag('dragEnd', 'A.cs');
        expect(highlighted()).toEqual([]);
    });

    it('Ctrl copies files and folders; projects are moved anyway', () => {
        const { drag, transfer, moves } = setup();
        drag('dragStart', 'A.cs');
        drag('dragOver', 'Controllers', true);
        expect(transfer.dropEffect).toBe('copy');
        drag('drop', 'Controllers', true);
        expect(moves()).toEqual([{ nodeIds: ['A.cs'], targetNodeId: 'Controllers', copy: true }]);

        drag('dragStart', 'Api');
        drag('dragOver', 'Tools', true);
        expect(transfer.dropEffect).toBe('move');
    });

    it('Windows and Linux: Cmd/Win and Alt do not copy', () => {
        const { drag, transfer, moves } = setup();
        drag('dragStart', 'A.cs');
        drag('dragOver', 'Controllers', { metaKey: true });
        expect(transfer.dropEffect).toBe('move');
        drag('dragOver', 'Controllers', { altKey: true });
        expect(transfer.dropEffect).toBe('move');
        drag('drop', 'Controllers', { altKey: true });
        expect(moves()).toEqual([{ nodeIds: ['A.cs'], targetNodeId: 'Controllers', copy: false }]);
    });

    it('macOS: Cmd and Option copy too', () => {
        Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
        try {
            const { drag, transfer, moves } = setup();
            drag('dragStart', 'A.cs');
            drag('dragOver', 'Controllers', { metaKey: true });
            expect(transfer.dropEffect).toBe('copy');
            drag('dragOver', 'Controllers', { altKey: true });
            expect(transfer.dropEffect).toBe('copy');
            drag('drop', 'Controllers', { altKey: true });
            expect(moves()).toEqual([{ nodeIds: ['A.cs'], targetNodeId: 'Controllers', copy: true }]);
        } finally {
            delete (navigator as any).platform;
        }
    });

    it('hovering a collapsed folder for a moment expands it', () => {
        jest.useFakeTimers();
        try {
            const { drag, onExpandNode } = setup();
            drag('dragStart', 'A.cs');
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(400); });
            // dragover repeats while the pointer rests: the timer keeps running
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(200); });
            expect(onExpandNode).not.toHaveBeenCalled();
            act(() => { jest.advanceTimersByTime(200); });
            expect(onExpandNode).toHaveBeenCalledWith('Models');
        } finally {
            jest.useRealTimers();
        }
    });

    it('leaving the folder earlier does not expand it', () => {
        jest.useFakeTimers();
        try {
            const { drag, onExpandNode } = setup();
            drag('dragStart', 'A.cs');
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(300); });
            drag('dragOver', 'A.cs');
            act(() => { jest.advanceTimersByTime(1000); });
            expect(onExpandNode).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('nothing can be dragged while a name is being edited', () => {
        const { row, drag } = setup();
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'startRename', payload: { nodeId: 'B.cs' } } })); });
        expect(row('A.cs').getAttribute('draggable')).toBe('false');
        const start = drag('dragStart', 'A.cs');
        expect(start.defaultPrevented).toBe(true);
    });

    // jsdom's MouseEvent has no movementX/Y: set by hand, like the modifier keys of the drag events
    const mouseMove = (target: Element, movement: number) => {
        const event = createEvent.mouseMove(target);
        Object.defineProperty(event, 'movementX', { value: movement });
        Object.defineProperty(event, 'movementY', { value: 0 });
        fireEvent(target, event);
    };
    const hovered = () => [...document.querySelectorAll('.tree-node.hovered')].map(el => el.textContent);

    it('the hover highlight follows the mouse', () => {
        const { row } = setup();
        fireEvent.mouseOver(row('A.cs'));
        expect(hovered()).toEqual(['A.cs']);
        fireEvent.mouseOver(row('B.cs'));
        expect(hovered()).toEqual(['B.cs']);
    });

    it('a drag clears the hover highlight; after the drop it comes back only when the mouse really moves', () => {
        const { row, drag } = setup();
        fireEvent.mouseOver(row('B.cs'));
        drag('dragStart', 'B.cs');
        expect(hovered()).toEqual([]);
        drag('dragOver', 'Controllers');
        drag('drop', 'Controllers');
        drag('dragEnd', 'B.cs');
        expect(hovered()).toEqual([]);

        // What Chromium sends after the drop, at the point where the drag started: no movement
        fireEvent.mouseOver(row('A.cs'));
        mouseMove(row('A.cs'), 0);
        expect(hovered()).toEqual([]);

        mouseMove(row('Models'), 3);
        expect(hovered()).toEqual(['Models']);
        fireEvent.mouseOver(row('A.cs'));
        expect(hovered()).toEqual(['A.cs']);
    });

    it('the hover highlight goes when the mouse is below the rows or leaves the tree', () => {
        const { row } = setup();
        const tree = document.querySelector('.solution-tree')!;
        fireEvent.mouseOver(row('A.cs'));
        fireEvent.mouseOver(tree);
        expect(hovered()).toEqual([]);
        fireEvent.mouseOver(row('A.cs'));
        fireEvent.mouseLeave(tree);
        expect(hovered()).toEqual([]);
    });

    it('the stylesheet highlights the hovered row by its class, not with :hover', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../../../../webview/providers/views/SolutionWebview.ts'), 'utf8');
        expect(html).not.toContain('.tree-node:hover');
        expect(html).toContain('.tree-node.hovered {');
    });
});
