import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../../../webview/configuration-view/App';
import { ConfigurationManagerRequest, ConfigurationManagerState } from '../../../../types/configurationManager';

const state = (platforms = ['Any CPU', 'x64']): ConfigurationManagerState => ({
    configurations: ['Debug', 'Release'], platforms, activeConfiguration: 'Debug', activePlatform: 'Any CPU',
    projects: [{ path: '/repo/Web/Web.csproj', name: 'Web', configurations: ['Debug', 'Release'], platforms }],
    mappings: {},
});

const send = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data })); });

function setup() {
    const sent: ConfigurationManagerRequest[] = [];
    render(<App api={{ postMessage: (r: ConfigurationManagerRequest) => sent.push(r) }} />);
    return sent;
}

describe('Configuration Manager App', () => {
    it('posts ready on mount', () => {
        expect(setup()).toEqual([{ type: 'ready' }]);
    });

    it('renders a state message', () => {
        setup();
        send({ type: 'state', state: state() });
        expect(screen.getByLabelText('Active solution configuration').textContent).toContain('Debug');
        expect(screen.getByLabelText('Active solution platform').textContent).toContain('Any CPU');
        expect(screen.getByText('Web')).toBeTruthy();
    });

    it('posts setActive with both values', () => {
        const sent = setup();
        send({ type: 'state', state: state() });
        fireEvent.click(screen.getByLabelText('Active solution configuration'));
        fireEvent.click(screen.getAllByRole('option').find(o => o.getAttribute('data-value') === 'Release')!);
        expect(sent[sent.length - 1]).toEqual({ type: 'setActive', configuration: 'Release', platform: 'Any CPU' });
    });

    it('shows an error banner, dismissable, and clears it on the next state', () => {
        setup();
        send({ type: 'state', state: state() });
        send({ type: 'error', message: 'Cannot remove' });
        expect(screen.getByRole('alert').textContent).toContain('Cannot remove');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('alert')).toBeNull();
        send({ type: 'error', message: 'Again' });
        send({ type: 'state', state: state() });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('hides the platform select with a single platform', () => {
        setup();
        send({ type: 'state', state: state(['Any CPU']) });
        expect(screen.queryByLabelText('Active solution platform')).toBeNull();
    });

    it('toggles the editors', () => {
        setup();
        send({ type: 'state', state: state() });
        fireEvent.click(screen.getByRole('button', { name: 'Edit Configurations...' }));
        expect(screen.getByLabelText('New configuration name')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Platforms...' }));
        expect(screen.getByLabelText('New platform name')).toBeTruthy();
    });
});
