import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../../../webview/publish-view/App';
import { PublishInit, PublishRequest } from '../../../../types/publish';

const settings = {
    configuration: 'Release', targetFramework: 'net10.0', publishDir: 'bin/Release/net10.0/publish/',
    selfContained: false, runtimeIdentifier: undefined, singleFile: false, readyToRun: false, trimmed: false, deleteExistingFiles: false,
};
const init = (overrides: Partial<PublishInit> = {}): PublishInit => ({
    projectName: 'Shop.Web',
    profiles: [
        { name: 'Azure', target: 'ZipDeploy', settings, publishFolder: '/repo/Web/x' },
        { name: 'FolderProfile', target: 'Folder', settings, publishFolder: '/repo/Web/bin/Release/net10.0/publish' },
    ],
    selected: 'FolderProfile',
    configurations: ['Debug', 'Release'],
    frameworks: ['net8.0', 'net10.0'],
    runtimes: ['win-x64', 'linux-x64'],
    hostRuntime: 'linux-x64',
    newProfile: settings,
    ...overrides,
});

function setup(data: PublishInit) {
    const sent: PublishRequest[] = [];
    render(<App api={{ postMessage: (request: PublishRequest) => sent.push(request) }} />);
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'init', payload: data } })); });
    return sent;
}

const last = <T,>(items: T[]) => items[items.length - 1];

const summary = () => Object.fromEntries([...document.querySelectorAll('.summary dt')].map(dt => [dt.textContent, dt.nextElementSibling!.textContent]));

describe('Publish tab', () => {
    it('shows the profile like Visual Studio\'s publish page and publishes it', () => {
        const sent = setup(init());

        expect(sent).toEqual([{ type: 'ready' }]);
        expect(summary()).toEqual(expect.objectContaining({
            'Target': 'Folder',
            'Target location': '/repo/Web/bin/Release/net10.0/publish',
            'Configuration': 'Release',
            'Target framework': 'net10.0',
            'Deployment mode': 'Framework-dependent',
            'Target runtime': 'Portable',
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(last(sent)).toEqual({ type: 'publish', profile: 'FolderProfile' });

        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'publishing', profile: 'FolderProfile' } })); });
        expect(screen.getByRole('button', { name: 'Publishing...' })).toHaveProperty('disabled', true);
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'published', profile: 'FolderProfile', succeeded: false } })); });
        expect(screen.getByText(/Publish failed/)).toBeTruthy();
    });

    it('explains profiles of other targets instead of publishing them', () => {
        setup(init({ selected: 'Azure' }));

        expect(screen.getByRole('button', { name: 'Publish' })).toHaveProperty('disabled', true);
        expect(screen.getByText(/ZipDeploy/).textContent).toMatch(/not supported yet/);
    });

    it('starts with a new Folder profile when the project has none', () => {
        const sent = setup(init({ profiles: [], selected: undefined }));

        expect(screen.getByRole('heading', { name: 'Publish to a folder' })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Folder location'), { target: { value: '/srv/www/shop/' } });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

        expect(last(sent)).toEqual({ type: 'createProfile', publishDir: '/srv/www/shop/' });
    });

    it('edits all settings; self-contained picks this machine\'s runtime, and single file needs a runtime', () => {
        const sent = setup(init());
        fireEvent.click(screen.getByRole('button', { name: 'Show all settings' }));

        expect(screen.getByLabelText('Produce single file')).toHaveProperty('disabled', true);
        fireEvent.change(screen.getByLabelText('Deployment mode'), { target: { value: 'self-contained' } });
        expect(screen.getByLabelText('Target runtime')).toHaveProperty('value', 'linux-x64');
        fireEvent.click(screen.getByLabelText('Produce single file'));
        fireEvent.change(screen.getByLabelText('Target framework'), { target: { value: 'net8.0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(last(sent)).toEqual({
            type: 'saveSettings',
            profile: 'FolderProfile',
            settings: { ...settings, targetFramework: 'net8.0', selfContained: true, runtimeIdentifier: 'linux-x64', singleFile: true },
        });
    });

    it('drops the options that need a runtime when going back to Portable', () => {
        const sent = setup(init({
            profiles: [{ name: 'FolderProfile', target: 'Folder', publishFolder: '/x', settings: { ...settings, selfContained: true, runtimeIdentifier: 'linux-x64', singleFile: true, readyToRun: true, trimmed: true } }],
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Show all settings' }));
        fireEvent.change(screen.getByLabelText('Target runtime'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect((last(sent) as any).settings).toEqual({ ...settings, selfContained: false, runtimeIdentifier: undefined, singleFile: false, readyToRun: false, trimmed: false });
    });
});
