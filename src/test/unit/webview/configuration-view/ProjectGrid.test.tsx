import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectGrid } from '../../../../webview/configuration-view/ProjectGrid';
import { ConfigurationManagerRequest, ConfigurationManagerState } from '../../../../types/configurationManager';

const state = (overrides: Partial<ConfigurationManagerState> = {}): ConfigurationManagerState => ({
    configurations: ['Debug', 'Release'],
    platforms: ['Any CPU', 'x64'],
    activeConfiguration: 'Debug',
    activePlatform: 'Any CPU',
    projects: [
        { path: '/repo/Web/Web.csproj', name: 'Web', configurations: ['Debug', 'Release'], platforms: ['Any CPU', 'x64'] },
        { path: '/repo/Lib/Lib.csproj', name: 'Lib', configurations: ['Debug', 'Release'], platforms: ['AnyCPU'] },
    ],
    mappings: {},
    ...overrides,
});

function choose(label: string, value: string) {
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getAllByRole('option').find(o => o.getAttribute('data-value') === value)!);
}

describe('ProjectGrid', () => {
    it('renders the default mapping for projects without an explicit one', () => {
        render(<ProjectGrid state={state()} post={() => undefined} />);
        expect(screen.getByLabelText('Web configuration').textContent).toContain('Debug');
        expect(screen.getByLabelText('Web platform').textContent).toContain('Any CPU');
        expect((screen.getByLabelText('Web build') as HTMLInputElement).checked).toBe(true);
    });

    it('renders an explicit mapping of the active pair', () => {
        const mappings = { '/repo/Lib/Lib.csproj|Debug|Any CPU': { configuration: 'Release', platform: 'AnyCPU', build: false } };
        render(<ProjectGrid state={state({ mappings })} post={() => undefined} />);
        expect(screen.getByLabelText('Lib configuration').textContent).toContain('Release');
        expect(screen.getByLabelText('Lib platform').textContent).toContain('AnyCPU');
        expect((screen.getByLabelText('Lib build') as HTMLInputElement).checked).toBe(false);
    });

    it('posts setMapping when Build is toggled', () => {
        const sent: ConfigurationManagerRequest[] = [];
        render(<ProjectGrid state={state()} post={r => sent.push(r)} />);
        fireEvent.click(screen.getByLabelText('Web build'));
        expect(sent).toEqual([{
            type: 'setMapping', project: '/repo/Web/Web.csproj', configuration: 'Debug', platform: 'Any CPU',
            mapping: { configuration: 'Debug', platform: 'Any CPU', build: false },
        }]);
    });

    it('posts setMapping when a select changes, keeping the other values', () => {
        const sent: ConfigurationManagerRequest[] = [];
        render(<ProjectGrid state={state()} post={r => sent.push(r)} />);
        choose('Web configuration', 'Release');
        choose('Web platform', 'x64');
        expect(sent).toEqual([
            { type: 'setMapping', project: '/repo/Web/Web.csproj', configuration: 'Debug', platform: 'Any CPU', mapping: { configuration: 'Release', platform: 'Any CPU', build: true } },
            { type: 'setMapping', project: '/repo/Web/Web.csproj', configuration: 'Debug', platform: 'Any CPU', mapping: { configuration: 'Debug', platform: 'x64', build: true } },
        ]);
    });

    it('keeps a mapped value the project does not declare as an option', () => {
        const mappings = { '/repo/Lib/Lib.csproj|Debug|Any CPU': { configuration: 'Staging', platform: 'Any CPU', build: true } };
        render(<ProjectGrid state={state({ mappings })} post={() => undefined} />);
        expect(screen.getByLabelText('Lib configuration').textContent).toContain('Staging');
        fireEvent.click(screen.getByLabelText('Lib configuration'));
        expect(screen.getAllByRole('option').map(o => o.getAttribute('data-value'))).toEqual(['Staging', 'Debug', 'Release']);
    });
});
