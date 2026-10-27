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

    it('has a button for every action, and each reports its action', () => {
        const actions: string[] = [];
        render(<Toolbar state={null} onAction={action => actions.push(action)} />);
        for (const label of ['Solution Configuration', 'Select Framework', 'Start Debugging', 'Start Without Debugging', 'Sync with Active Document', 'Show All Files', 'Collapse All']) {
            fireEvent.click(screen.getByLabelText(label));
        }
        expect(actions).toEqual(['configuration', 'framework', 'debug', 'startWithoutDebugging', 'sync', 'showAllFiles', 'collapseAll']);
        expect([...actions].sort()).toEqual([...TOOLBAR_ACTIONS].sort());
    });

    it('shows Show All Files as pressed while it is on', () => {
        const { rerender } = render(<Toolbar state={{ configuration: 'Debug', showAllFiles: true }} onAction={() => { }} />);
        expect(screen.getByLabelText('Show All Files').getAttribute('aria-pressed')).toBe('true');
        rerender(<Toolbar state={{ configuration: 'Debug', showAllFiles: false }} onAction={() => { }} />);
        expect(screen.getByLabelText('Show All Files').getAttribute('aria-pressed')).toBe('false');
    });

    it('every action maps to a command the extension registers', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const declared = new Set((require('../../../../../package.json').contributes.commands as { command: string }[]).map(command => command.command));
        for (const action of TOOLBAR_ACTIONS) {
            expect(declared.has(TOOLBAR_COMMANDS[action])).toBe(true);
        }
    });
});
