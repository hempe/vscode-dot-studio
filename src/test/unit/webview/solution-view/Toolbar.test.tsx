// The Solution Explorer toolbar: buttons in the view instead of icons in the title bar
import { fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from '../../../../webview/solution-view/components/Toolbar';
import { TOOLBAR_ACTIONS, TOOLBAR_COMMANDS } from '../../../../types/toolbar';

describe('Toolbar', () => {
    it('shows the configuration and the framework or startup profile', () => {
        render(<Toolbar state={{ configuration: 'Debug | x64', startup: 'Web and Worker', showAllFiles: false }} onAction={() => { }} />);
        expect(screen.getByLabelText('Solution Configuration').textContent).toBe('Debug | x64');
        expect(screen.getByLabelText('Select Framework').textContent).toBe('Web and Worker');
    });

    it('shows them as dropdowns: text and an arrow, no icon of their own', () => {
        render(<Toolbar state={{ configuration: 'Debug', startup: 'net10.0', showAllFiles: false }} onAction={() => { }} />);
        for (const label of ['Solution Configuration', 'Select Framework']) {
            const icons = [...screen.getByLabelText(label).querySelectorAll('.codicon')].map(element => element.className);
            expect(icons).toEqual(['codicon codicon-chevron-down']);
        }
    });

    it('has one Start button, with the other ways to start and the rest in menus, and each reports its action', () => {
        const actions: string[] = [];
        render(<Toolbar state={null} onAction={action => actions.push(action)} />);
        for (const label of ['Solution Configuration', 'Select Framework', 'Start Debugging', 'Sync with Active Document', 'Show All Files', 'Collapse All']) {
            fireEvent.click(screen.getByLabelText(label));
        }
        // The other starts and Attach are behind the arrow, Open Solution and Create New Project behind the ellipsis
        for (const [menu, item] of [['More ways to start', 'Start Without Debugging'], ['More ways to start', 'Start with Hot Reload'], ['More ways to start', 'Attach to Process...'],
            ['More', 'Open Solution...'], ['More', 'Create New Project...']]) {
            fireEvent.click(screen.getByLabelText(menu));
            fireEvent.click(screen.getByRole('menuitem', { name: item }));
        }
        expect(actions).toEqual(['configuration', 'framework', 'debug', 'sync', 'showAllFiles', 'collapseAll',
            'startWithoutDebugging', 'startWithHotReload', 'attachToProcess', 'openSolution', 'newSolution']);
        expect([...actions].sort()).toEqual([...TOOLBAR_ACTIONS].sort());
    });

    it('has no start button besides the one', () => {
        render(<Toolbar state={null} onAction={() => { }} />);
        expect(screen.queryByLabelText('Start Without Debugging')).toBeNull();
        expect(screen.getAllByRole('button').filter(button => /^Start/.test(button.getAttribute('aria-label') ?? ''))).toHaveLength(1);
    });

    it('a menu closes after a pick, on Escape and on a click elsewhere', () => {
        render(<Toolbar state={null} onAction={() => { }} />);
        const open = () => fireEvent.click(screen.getByLabelText('More ways to start'));

        open();
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Start with Hot Reload' }));
        expect(screen.queryByRole('menu')).toBeNull();

        open();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        open();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('shows Show All Files as pressed while it is on', () => {
        const { rerender } = render(<Toolbar state={{ configuration: 'Debug', showAllFiles: true }} onAction={() => { }} />);
        expect(screen.getByLabelText('Show All Files').getAttribute('aria-pressed')).toBe('true');
        rerender(<Toolbar state={{ configuration: 'Debug', showAllFiles: false }} onAction={() => { }} />);
        expect(screen.getByLabelText('Show All Files').getAttribute('aria-pressed')).toBe('false');
    });

    it('every action maps to a command the extension registers', () => {
        const declared = new Set((require('../../../../../package.json').contributes.commands as { command: string }[]).map(command => command.command));
        for (const action of TOOLBAR_ACTIONS) {
            expect(declared.has(TOOLBAR_COMMANDS[action])).toBe(true);
        }
    });
});

describe('Toolbar menus', () => {
    it('focus the first item when opened and move with the arrow keys, wrapping round', () => {
        render(<Toolbar state={null} onAction={() => { }} />);
        fireEvent.click(screen.getByLabelText('More ways to start'));
        const items = screen.getAllByRole('menuitem');
        expect(document.activeElement).toBe(items[0]);

        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(items[items.length - 1]);
    });
});
