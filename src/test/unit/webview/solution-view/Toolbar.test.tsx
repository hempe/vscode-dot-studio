// The Solution Explorer toolbar: buttons in the view instead of icons in the title bar
import { fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from '../../../../webview/solution-view/components/Toolbar';
import { TOOLBAR_ACTIONS, TOOLBAR_COMMANDS, ToolbarState } from '../../../../types/toolbar';

const state = (changes: Partial<ToolbarState> = {}): ToolbarState => ({
    configuration: 'Debug', configurations: ['Debug', 'Release'], activeConfiguration: 'Debug', platforms: ['Any CPU'], activePlatform: 'Any CPU', frameworks: [],
    showAllFiles: false, ...changes,
});
const show = (toolbarState: ToolbarState | null, onAction: (action: string) => void = () => { }, onChoose: (choice: string, value: string) => void = () => { }) =>
    render(<Toolbar state={toolbarState} onAction={onAction} onChoose={onChoose} />);

const menuItems = () => [...screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^=menuitem]')];
const menuItem = (name: string) => menuItems().find(item => item.textContent === name)!;

describe('Toolbar', () => {
    it('shows the configuration and the framework or startup profile as dropdowns: text and an arrow', () => {
        show(state({ configuration: 'Debug | x64', startup: 'Web and Worker' }));
        expect(screen.getByLabelText('Solution Configuration').textContent).toBe('Debug | x64');
        expect(screen.getByLabelText('Target Framework or Startup Profile').textContent).toBe('Web and Worker');
        for (const label of ['Solution Configuration', 'Target Framework or Startup Profile']) {
            const icons = [...screen.getByLabelText(label).querySelectorAll('.codicon')].map(element => element.className);
            expect(icons).toEqual(['codicon codicon-chevron-down']);
        }
    });

    it('the configuration menu lists the configurations (the active one checked), the platforms when there are several, and the rest', () => {
        show(state({ configurations: ['Debug', 'Release', 'Staging'], activeConfiguration: 'Release', platforms: ['Any CPU', 'x64'], activePlatform: 'x64' }));
        fireEvent.click(screen.getByLabelText('Solution Configuration'));

        const entries = menuItems().map(item => `${item.getAttribute('aria-checked') === 'true' ? '✓ ' : ''}${item.textContent}`);
        expect(entries).toEqual(['Debug', '✓ Release', 'Staging', 'Any CPU', '✓ x64', 'Startup Profile...', 'Configuration Manager...']);
    });

    it('without several platforms the menu has none, and with no state it still offers Debug and Release', () => {
        show(null);
        fireEvent.click(screen.getByLabelText('Solution Configuration'));
        expect(menuItems().map(item => item.textContent)).toEqual(['Debug', 'Release', 'Startup Profile...', 'Configuration Manager...']);
    });

    it('picking a configuration or a platform reports the choice with its name, the rest report their action', () => {
        const actions: string[] = [];
        const choices: string[] = [];
        show(state({ platforms: ['Any CPU', 'x64'] }), action => actions.push(action), (choice, value) => choices.push(`${choice}:${value}`));
        for (const item of ['Release', 'x64', 'Startup Profile...', 'Configuration Manager...']) {
            fireEvent.click(screen.getByLabelText('Solution Configuration'));
            fireEvent.click(menuItem(item));
        }
        expect(choices).toEqual(['setConfiguration:Release', 'setPlatform:x64']);
        expect(actions).toEqual(['startupProfile', 'configurationManager']);
    });

    it('the framework menu lists the frameworks (the active one checked) and the startup profiles, and a pick reports the framework', () => {
        const actions: string[] = [];
        const choices: string[] = [];
        show(state({ startup: 'net10.0', frameworks: [{ value: '', label: 'Auto', checked: false }, { value: 'net10.0', label: '.NET 10.0', checked: true }] }),
            action => actions.push(action), (choice, value) => choices.push(`${choice}:${value}`));
        fireEvent.click(screen.getByLabelText('Target Framework or Startup Profile'));
        expect(menuItems().map(item => `${item.getAttribute('aria-checked') === 'true' ? '✓ ' : ''}${item.textContent}`)).toEqual(['Auto', '✓ .NET 10.0', 'Startup Profile...']);
        fireEvent.click(menuItem('Auto'));
        fireEvent.click(screen.getByLabelText('Target Framework or Startup Profile'));
        fireEvent.click(menuItem('Startup Profile...'));
        expect(choices).toEqual(['setFramework:']);
        expect(actions).toEqual(['startupProfile']);
    });

    it('has one Start button, with the other ways to start and the rest in menus, and each reports its action', () => {
        const actions: string[] = [];
        show(null, action => actions.push(action));
        for (const label of ['Start Debugging', 'Sync with Active Document', 'Show All Files', 'Collapse All']) {
            fireEvent.click(screen.getByLabelText(label));
        }
        for (const [menu, item] of [['More ways to start', 'Start Without Debugging'], ['More ways to start', 'Start with Hot Reload'], ['More ways to start', 'Attach to Process...'],
            ['More', 'Open Solution...'], ['More', 'Create New Project...']]) {
            fireEvent.click(screen.getByLabelText(menu));
            fireEvent.click(menuItem(item));
        }
        fireEvent.click(screen.getByLabelText('Solution Configuration'));
        fireEvent.click(menuItem('Startup Profile...'));
        fireEvent.click(screen.getByLabelText('Solution Configuration'));
        fireEvent.click(menuItem('Configuration Manager...'));

        expect([...actions].sort()).toEqual([...TOOLBAR_ACTIONS].sort());
    });

    it('has no start button besides the one', () => {
        show(null);
        expect(screen.queryByLabelText('Start Without Debugging')).toBeNull();
        expect(screen.getAllByRole('button').filter(button => /^Start/.test(button.getAttribute('aria-label') ?? ''))).toHaveLength(1);
    });

    it('a menu closes after a pick, on Escape and on a click elsewhere', () => {
        show(null);
        const open = () => fireEvent.click(screen.getByLabelText('More ways to start'));

        open();
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.click(menuItem('Start with Hot Reload'));
        expect(screen.queryByRole('menu')).toBeNull();

        open();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        open();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('shows Show All Files as pressed while it is on', () => {
        const { rerender } = show(state({ showAllFiles: true }));
        expect(screen.getByLabelText('Show All Files').getAttribute('aria-pressed')).toBe('true');
        rerender(<Toolbar state={state({ showAllFiles: false })} onAction={() => { }} onChoose={() => { }} />);
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
    it('highlight nothing when opened (the menu has the focus, no item) and move with the arrow keys, wrapping round', () => {
        show(null);
        fireEvent.click(screen.getByLabelText('More ways to start'));
        const items = screen.getAllByRole('menuitem');
        const menu = screen.getByRole('menu');
        expect(document.activeElement).toBe(menu);

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0]);
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(items[items.length - 1]);
    });
});
