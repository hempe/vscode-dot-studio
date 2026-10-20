import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../../../webview/startup-view/App';
import { StartupProjectsRequest, StartupProjectsState } from '../../../../types/startupProjects';

const state = (overrides: Partial<StartupProjectsState> = {}): StartupProjectsState => ({
    projects: [
        { path: 'Shop.Web/Shop.Web.csproj', name: 'Shop.Web', launchProfiles: ['http', 'https'], unloaded: false },
        { path: 'Shop.Worker/Shop.Worker.csproj', name: 'Shop.Worker', launchProfiles: [], unloaded: false },
        { path: 'Shop.Core/Shop.Core.csproj', name: 'Shop.Core', launchProfiles: [], unloaded: false },
    ],
    startable: ['Shop.Web/Shop.Web.csproj', 'Shop.Worker/Shop.Worker.csproj'],
    singleProject: 'Shop.Web/Shop.Web.csproj',
    profiles: [],
    unreadable: [],
    ...overrides,
});

const WITH_PROFILES = state({
    active: { name: 'Both', shared: true },
    profiles: [
        { name: 'Both', shared: true, projects: [
            { path: 'Shop.Worker/Shop.Worker.csproj', action: 'StartWithoutDebugging' },
            { path: 'Shop.Web/Shop.Web.csproj', action: 'Start', launchProfile: 'https' },
        ] },
        { name: 'Mine', shared: false, projects: [{ path: 'Shop.Web/Shop.Web.csproj', action: 'Start' }] },
    ],
});

const send = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data })); });

function setup(initial?: StartupProjectsState) {
    const sent: StartupProjectsRequest[] = [];
    render(<App api={{ postMessage: (request: StartupProjectsRequest) => sent.push(request) }} />);
    if (initial) {
        send({ type: 'state', state: initial });
    }
    return sent;
}

const choose = (label: string, option: string) => {
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getAllByRole('option').find(o => o.textContent === option)!);
};
const rowNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map(row => row.querySelector('td')?.textContent);
const last = (sent: StartupProjectsRequest[]) => sent[sent.length - 1];

describe('Configure Startup Projects App', () => {
    it('posts ready and renders the single startup project when no profile is active', () => {
        const sent = setup(state());
        expect(sent).toEqual([{ type: 'ready' }]);
        expect((screen.getByLabelText('Single startup project', { selector: 'input' }) as HTMLInputElement).checked).toBe(true);
        expect(screen.getByRole('button', { name: 'Single startup project' }).textContent).toContain('Shop.Web');
        expect(screen.queryByLabelText('Profile name')).toBeNull();
    });

    it('the dropdown lists the startable projects and posts setSingle', () => {
        const sent = setup(state());
        fireEvent.click(screen.getByRole('button', { name: 'Single startup project' }));
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Shop.Web', 'Shop.Worker']);
        fireEvent.click(screen.getByRole('option', { name: 'Shop.Worker' }));
        expect(last(sent)).toEqual({ type: 'setSingle', project: 'Shop.Worker/Shop.Worker.csproj' });
    });

    it('shows the multiple mode with every project, the profile\'s own in its order first', () => {
        setup(WITH_PROFILES);
        expect((screen.getByLabelText('Multiple startup projects') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('Both');
        expect((screen.getByLabelText(/Share profile/) as HTMLInputElement).checked).toBe(true);
        expect(rowNames()).toEqual(['Shop.Worker', 'Shop.Web', 'Shop.Core']);
        expect(within(screen.getByRole('table')).getByText('Shop.Web').getAttribute('title')).toBe('Shop.Web/Shop.Web.csproj');
        expect(screen.getByLabelText('Shop.Worker action').textContent).toContain('Start without debugging');
        expect(screen.getByLabelText('Shop.Web launch profile').textContent).toContain('https');
        expect(screen.getByLabelText('Shop.Core action').textContent).toContain('None');
        // User profiles are marked, the active one too
        expect(screen.getByRole('button', { name: /Mine/ }).textContent).toContain('user file');
        expect(screen.getByRole('button', { name: /Both/ }).textContent).toContain('active');
    });

    it('Apply is disabled until something changed; Apply posts the profile with the edited rows', () => {
        const sent = setup(WITH_PROFILES);
        const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
        expect(apply.disabled).toBe(true);
        expect(screen.queryByText('Unsaved changes')).toBeNull();

        choose('Shop.Core action', 'Start');
        expect(screen.getByText('Unsaved changes')).toBeTruthy();
        expect(apply.disabled).toBe(false);
        fireEvent.click(apply);
        expect(last(sent)).toEqual({
            type: 'applyProfile',
            original: { name: 'Both', shared: true },
            profile: { name: 'Both', shared: true, projects: [
                { path: 'Shop.Worker/Shop.Worker.csproj', action: 'StartWithoutDebugging' },
                { path: 'Shop.Web/Shop.Web.csproj', action: 'Start', launchProfile: 'https' },
                { path: 'Shop.Core/Shop.Core.csproj', action: 'Start' },
            ] },
        });
        expect(apply.disabled).toBe(true);
    });

    it('picks the launch profile ("(default)" clears it) and the actions', () => {
        const sent = setup(WITH_PROFILES);
        choose('Shop.Web launch profile', '(default)');
        choose('Shop.Worker action', 'None');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect((last(sent) as any).profile.projects).toEqual([
            { path: 'Shop.Worker/Shop.Worker.csproj', action: 'None' },
            { path: 'Shop.Web/Shop.Web.csproj', action: 'Start' },
            { path: 'Shop.Core/Shop.Core.csproj', action: 'None' },
        ]);
        // Projects without launch profiles have nothing to pick
        expect((screen.getByLabelText('Shop.Core launch profile') as HTMLButtonElement).disabled).toBe(true);
    });

    it('reorders with the up and down buttons', () => {
        const sent = setup(WITH_PROFILES);
        expect((screen.getByLabelText('Move Shop.Worker up') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText('Move Shop.Core down') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByLabelText('Move Shop.Worker down'));
        expect(rowNames()).toEqual(['Shop.Web', 'Shop.Worker', 'Shop.Core']);
        fireEvent.click(screen.getByLabelText('Move Shop.Core up'));
        expect(rowNames()).toEqual(['Shop.Web', 'Shop.Core', 'Shop.Worker']);
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect((last(sent) as any).profile.projects.map((p: any) => p.path)).toEqual([
            'Shop.Web/Shop.Web.csproj', 'Shop.Core/Shop.Core.csproj', 'Shop.Worker/Shop.Worker.csproj']);
    });

    it('the share checkbox moves the profile between the files, a rename keeps the original name', () => {
        const sent = setup(WITH_PROFILES);
        fireEvent.click(screen.getByLabelText(/Share profile/));
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Everything' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(last(sent)).toMatchObject({
            type: 'applyProfile', original: { name: 'Both', shared: true }, profile: { name: 'Everything', shared: false },
        });
    });

    it('disables Apply for an empty or duplicate name and says why', () => {
        setup(WITH_PROFILES);
        const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: ' ' } });
        expect(apply.disabled).toBe(true);
        expect(screen.getByText('Give the profile a name.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'mine' } });
        expect(apply.disabled).toBe(true);
        expect(screen.getByText('A profile with this name exists.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Mine2' } });
        expect(apply.disabled).toBe(false);
    });

    it('New profile starts with the default name, no actions and an unshared file', () => {
        const sent = setup(WITH_PROFILES);
        fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
        expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('Startup');
        expect((screen.getByLabelText(/Share profile/) as HTMLInputElement).checked).toBe(false);
        expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
        choose('Shop.Web action', 'Start');
        choose('Shop.Worker action', 'Start');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(last(sent)).toEqual({
            type: 'applyProfile',
            profile: { name: 'Startup', shared: false, projects: [
                { path: 'Shop.Web/Shop.Web.csproj', action: 'Start' },
                { path: 'Shop.Worker/Shop.Worker.csproj', action: 'Start' },
                { path: 'Shop.Core/Shop.Core.csproj', action: 'None' },
            ] },
        });
    });

    it('selects another profile to edit and deletes it', () => {
        const sent = setup(WITH_PROFILES);
        fireEvent.click(screen.getByRole('button', { name: /Mine/ }));
        expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('Mine');
        expect((screen.getByLabelText(/Share profile/) as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(last(sent)).toEqual({ type: 'deleteProfile', name: 'Mine', shared: false });
    });

    it('the radio goes back to the single startup project only when a profile is active', () => {
        const sent = setup(WITH_PROFILES);
        fireEvent.click(screen.getByLabelText('Single startup project', { selector: 'input' }));
        expect(last(sent)).toEqual({ type: 'useSingle' });
        expect(screen.queryByLabelText('Profile name')).toBeNull();

        send({ type: 'state', state: state({ ...WITH_PROFILES, active: undefined }) });
        const before = sent.length;
        fireEvent.click(screen.getByLabelText('Multiple startup projects'));
        fireEvent.click(screen.getByLabelText('Single startup project', { selector: 'input' }));
        expect(sent).toHaveLength(before);
    });

    it('shows an error banner (dismissable), keeps the edit, and unreadable files as alerts', () => {
        setup(state({ ...WITH_PROFILES, unreadable: ['Shop.slnLaunch cannot be read: not valid JSON'] }));
        expect(screen.getByRole('alert').textContent).toContain('Shop.slnLaunch cannot be read');
        choose('Shop.Core action', 'Start');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        send({ type: 'error', message: 'There is already a profile named "Mine".' });
        expect(screen.getAllByRole('alert').map(a => a.textContent).join()).toContain('already a profile');
        expect(screen.getByText('Unsaved changes')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
        expect(screen.queryByText(/already a profile/)).toBeNull();
    });

    it('after Apply the answering state replaces the edit and selects the saved profile', () => {
        setup(WITH_PROFILES);
        choose('Shop.Core action', 'Start');
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        send({ type: 'state', state: state({
            active: { name: 'Renamed', shared: true },
            profiles: [{ name: 'Renamed', shared: true, projects: [{ path: 'Shop.Core/Shop.Core.csproj', action: 'Start' }] }],
        }) });
        expect(screen.queryByText('Unsaved changes')).toBeNull();
        expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('Renamed');
        expect(rowNames()).toEqual(['Shop.Core', 'Shop.Web', 'Shop.Worker']);
    });

    it('marks unloaded projects', () => {
        setup(state({ projects: [{ path: 'A/A.csproj', name: 'A', launchProfiles: [], unloaded: true }], startable: [], singleProject: undefined, active: { name: 'P', shared: false },
            profiles: [{ name: 'P', shared: false, projects: [] }] }));
        expect(screen.getByText('A (unloaded)')).toBeTruthy();
    });
});
