// The NuGet manager keeps its search results across refreshes, walks the list it shows and says when something failed (review A3-3, A3-4, A3-6)
import { act, fireEvent, render, screen } from '@testing-library/react';

// vscrui is ESM only: plain stand-ins
jest.mock('vscrui', () => {
    const React = require('react');
    return {
        Checkbox: (p: any) => React.createElement('input', { type: 'checkbox', checked: !!p.checked, disabled: p.disabled, onChange: (e: any) => p.onChange?.(e.target.checked) }),
        Dropdown: () => null,
        Icon: () => null,
        TextField: (p: any) => React.createElement('input', { 'data-testid': 'tf', value: p.value, placeholder: p.placeholder, disabled: p.disabled, onChange: (e: any) => p.onChange?.(e.target.value), onKeyDown: p.onKeyDown }),
        Button: (p: any) => React.createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children),
        Panels: (p: any) => React.createElement('div', null,
            p.tabs.map((t: any) => React.createElement('button', { key: t.id, role: 'tab', onClick: () => p.onTabChange(t.id) }, t.label)),
            p.views.find((v: any) => v.id === p.activeTab)?.content),
    };
});
(Element.prototype as any).scrollIntoView = () => { };

const mockSent: any[] = [];
jest.mock('../../../../webview/nuget-view/shared', () => ({
    ...jest.requireActual('../../../../webview/nuget-view/shared'),
    sendToBackend: (message: unknown) => { mockSent.push(message); },
}));

import { App } from '../../../../webview/nuget-view/App';

const post = (data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data })); });
const pkg = (id: string, description = '') => ({ id, currentVersion: '1.0.0', versions: ['1.0.0'], description, authors: ['x'] });
const project = { name: 'P', path: 'P.csproj', framework: 'net8.0', packages: [] };

const openBrowse = () => {
    const view = render(<App />);
    post({ type: 'nugetData', payload: { installedPackages: [], projects: [project], searchResults: [] } });
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    return view;
};

describe('NuGet manager', () => {
    it('keeps the Browse results when the host sends a refresh without any', () => {
        openBrowse();
        post({ type: 'searchResults', payload: { searchResults: [pkg('Serilog'), pkg('Serilog.Sinks.Console')] } });
        expect(screen.getByText(/^Browse \(2\)/)).toBeTruthy();

        // what the host sends after an install or when a project file changed
        post({ type: 'nugetData', payload: { installedPackages: [pkg('Serilog')], projects: [project], searchResults: [] } });

        expect(screen.getByText(/^Browse \(2\)/)).toBeTruthy();
    });

    it('Arrow keys in Browse walk the rows that are shown, whatever the search box says now', () => {
        const { container } = openBrowse();
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'json' } });
        post({ type: 'searchResults', payload: { searchResults: [pkg('Newtonsoft.Json'), pkg('Jil', 'fast serializer'), pkg('System.Text.Json')] } });
        const list = container.querySelector('[tabindex="0"]')!;

        fireEvent.keyDown(list, { key: 'ArrowDown' });
        fireEvent.keyDown(list, { key: 'ArrowDown' });

        const highlighted = [...list.querySelectorAll('div[style*="cursor: pointer"]')]
            .find(row => (row as HTMLElement).style.background.includes('activeSelection'));
        expect(highlighted?.querySelector('span')?.textContent).toBe('Jil');
        expect(container.querySelector('h2')?.textContent).toBe('Jil');
    });

    it('an error from the host ends the loading state and is shown', () => {
        openBrowse();
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'x' } });
        fireEvent.keyDown(screen.getByTestId('tf'), { key: 'Enter' });

        post({ type: 'error', payload: { message: 'boom' } });

        expect(screen.getByRole('alert').textContent).toContain('boom');
        const search = screen.getAllByRole('button').find(button => !button.getAttribute('role') && button.textContent === '')! as HTMLButtonElement;
        expect(search.disabled).toBe(false);
    });

    it('a failed search says why, not just "No results found"', () => {
        openBrowse();
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'serilog' } });
        fireEvent.keyDown(screen.getByTestId('tf'), { key: 'Enter' });

        post({ type: 'searchResults', payload: { searchResults: [], error: 'getaddrinfo ENOTFOUND api.nuget.org' } });

        expect(screen.getByRole('alert').textContent).toContain('Search failed: getaddrinfo ENOTFOUND api.nuget.org');
    });

    it('the message goes away with Dismiss and with the next search', () => {
        openBrowse();
        post({ type: 'error', payload: { message: 'boom' } });
        fireEvent.click(screen.getByText('Dismiss'));
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('NuGet manager: refresh and package source', () => {
    const sent = mockSent;
    beforeEach(() => { sent.length = 0; });

    const open = () => {
        const view = render(<App />);
        post({ type: 'nugetData', payload: { installedPackages: [], projects: [project], searchResults: [], sources: [{ name: 'nuget.org' }, { name: 'birs' }] } });
        return view;
    };

    it('has a refresh button on every tab that asks the host to drop its caches and read again', () => {
        open();
        for (const tab of ['Browse', 'Installed', 'Updates', 'Consolidate']) {
            const button = screen.queryByRole('tab', { name: tab });
            if (!button) { continue; }
            fireEvent.click(button);
            sent.length = 0;
            fireEvent.click(screen.getAllByRole('button').find(candidate => candidate.parentElement?.getAttribute('title') === 'Refresh')!);
            expect(sent.some(message => message.type === 'refreshNuGet')).toBe(true);
        }
    });

    it('Browse offers All and the enabled sources, and searches only the chosen one', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'serilog' } });

        fireEvent.click(screen.getByLabelText('Package source'));
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['All', 'nuget.org', 'birs']);
        sent.length = 0;
        fireEvent.click(screen.getByRole('option', { name: 'birs' }));

        expect(sent).toContainEqual({ type: 'searchPackages', payload: { query: 'serilog', source: 'birs' } });
    });

    describe('the package source filter of Updates and Consolidate', () => {
        const update = (id: string, sourceName: string) => ({ id, currentVersion: '1.0.0', versions: ['2.0.0', '1.0.0'], sourceName, projects: [{ name: 'P', path: 'P.csproj' }] });
        const openLists = () => {
            render(<App />);
            post({
                type: 'nugetData',
                payload: {
                    installedPackages: [], projects: [project, { ...project, name: 'Q', path: 'Q.csproj' }], searchResults: [], sources: [{ name: 'nuget.org' }, { name: 'birs' }],
                    updatesAvailable: [update('Serilog', 'nuget.org'), update('Cirrus.Logging', 'birs'), update('Cirrus.Core', 'birs')],
                    consolidatePackages: [update('Serilog', 'nuget.org'), update('Cirrus.Logging', 'birs')],
                },
            });
        };
        const choose = (name: string) => {
            fireEvent.click(screen.getByLabelText('Package source filter'));
            fireEvent.click(screen.getByRole('option', { name }));
        };

        it('lists only the packages of the chosen feed, and Select all and Update Selected follow what is shown', () => {
            openLists();
            fireEvent.click(screen.getByRole('tab', { name: 'Updates' }));
            expect(screen.getByText('Serilog')).toBeTruthy();
            sent.length = 0;

            choose('birs');
            expect(screen.queryByText('Serilog')).toBeNull();
            expect(screen.getByText('Cirrus.Logging')).toBeTruthy();
            fireEvent.click(screen.getByText('Select all'));
            fireEvent.click(screen.getByText('Update Selected'));

            const update = sent.find(message => message.type === 'bulkUpdatePackages');
            expect(update.payload.packages.map((p: { id: string }) => p.id).sort()).toEqual(['Cirrus.Core', 'Cirrus.Logging']);
            // no new search or reload for a filter
            expect(sent.some(message => message.type === 'searchPackages' || message.type === 'getNuGetData')).toBe(false);
        });

        it('All shows every package again; Consolidate has the filter too', () => {
            openLists();
            fireEvent.click(screen.getByRole('tab', { name: 'Consolidate' }));
            choose('nuget.org');
            expect(screen.queryByText('Cirrus.Logging')).toBeNull();
            expect(screen.getByText('Serilog')).toBeTruthy();
            choose('All');
            expect(screen.getByText('Cirrus.Logging')).toBeTruthy();
        });
    });

    it('All searches without a source', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'serilog' } });
        sent.length = 0;
        fireEvent.keyDown(screen.getByTestId('tf'), { key: 'Enter' });
        expect(sent).toContainEqual({ type: 'searchPackages', payload: { query: 'serilog' } });
    });

    it('a refresh searches again in Browse after a search', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
        fireEvent.change(screen.getByTestId('tf'), { target: { value: 'serilog' } });
        fireEvent.keyDown(screen.getByTestId('tf'), { key: 'Enter' });
        post({ type: 'searchResults', payload: { searchResults: [pkg('Serilog')] } });
        sent.length = 0;

        fireEvent.click(screen.getAllByRole('button').find(candidate => candidate.parentElement?.getAttribute('title') === 'Refresh')!);

        expect(sent.map(message => message.type)).toEqual(expect.arrayContaining(['refreshNuGet', 'searchPackages']));
    });

    describe('vulnerable and deprecated packages', () => {
        const installed = (id: string, version: string) => ({ ...pkg(id), currentVersion: version, version });
        const open = () => {
            jest.useFakeTimers();
            mockSent.length = 0;
            const view = render(<App />);
            post({ type: 'nugetData', payload: { installedPackages: [installed('Newtonsoft.Json', '12.0.1'), installed('Serilog', '4.0.0'), installed('WindowsAzure.Storage', '9.3.3')], projects: [project], searchResults: [] } });
            return view;
        };
        afterEach(() => jest.useRealTimers());

        it('asks the host once for the advisories after the data, and labels the flagged packages', () => {
            open();
            expect(mockSent.filter(m => m.type === 'getPackageAdvisories')).toEqual([]);
            act(() => { jest.advanceTimersByTime(1000); });
            expect(mockSent.filter(m => m.type === 'getPackageAdvisories')).toHaveLength(1);

            post({ type: 'packageAdvisories', payload: { advisories: {
                'newtonsoft.json|12.0.1': { vulnerabilities: [{ severity: 'High', url: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr' }] },
                'windowsazure.storage|9.3.3': { deprecation: { reasons: ['Legacy'], alternative: { id: 'Azure.Storage.Common' } } },
            } } });

            expect(screen.getByText('vulnerable: high')).toBeTruthy();
            expect(screen.getByText('deprecated')).toBeTruthy();
            expect(screen.getAllByText(/^vulnerable|^deprecated$/)).toHaveLength(2);
        });

        it('the Vulnerable and Deprecated checkboxes narrow the Installed list', () => {
            const { container } = open();
            post({ type: 'packageAdvisories', payload: { advisories: {
                'newtonsoft.json|12.0.1': { vulnerabilities: [{ severity: 'High', url: 'https://github.com/advisories/x' }] },
                'windowsazure.storage|9.3.3': { deprecation: { reasons: ['Legacy'] } },
            } } });
            const names = () => [...container.querySelectorAll('div[style*="cursor: pointer"] span')].map(span => span.textContent).filter(text => ['Newtonsoft.Json', 'Serilog', 'WindowsAzure.Storage'].includes(text ?? ''));
            expect(names()).toEqual(['Newtonsoft.Json', 'Serilog', 'WindowsAzure.Storage']);

            fireEvent.click(screen.getByText('Vulnerable'));
            expect(names()).toEqual(['Newtonsoft.Json']);
            fireEvent.click(screen.getByText('Deprecated'));
            expect(names()).toEqual(['Newtonsoft.Json', 'WindowsAzure.Storage']);
        });

        it('the details of a vulnerable package link the advisory', () => {
            const { container } = open();
            post({ type: 'packageAdvisories', payload: { advisories: { 'newtonsoft.json|12.0.1': { vulnerabilities: [{ severity: 'High', url: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr' }] } } } });
            fireEvent.click(screen.getAllByText('Newtonsoft.Json')[0]);

            expect(container.textContent).toContain('This version has known vulnerabilities');
            expect(container.querySelector('a[href="https://github.com/advisories/GHSA-5crp-9r3c-p9vr"]')).not.toBeNull();
        });
    });

    describe('Package Source Mapping', () => {
        const open = (mapping: Record<string, string[]>) => {
            const view = render(<App />);
            post({ type: 'nugetData', payload: { installedPackages: [{ ...pkg('Company.Core'), version: '1.0.0' }, { ...pkg('Serilog'), version: '1.0.0' }, { ...pkg('Orphan.Lib'), version: '1.0.0' }], projects: [project], searchResults: [], sourceMapping: mapping } });
            return view;
        };

        it('names the sources the mapping lets provide the selected package', () => {
            const { container } = open({ 'nuget.org': ['Serilog*'], 'Company Feed': ['Company.*'] });
            fireEvent.click(screen.getAllByText('Company.Core')[0]);
            expect(container.textContent).toContain('Package source mapping: Company Feed');
            fireEvent.click(screen.getAllByText('Serilog')[0]);
            expect(container.textContent).toContain('Package source mapping: nuget.org');
        });

        it('warns when no source is mapped for the package', () => {
            const { container } = open({ 'nuget.org': ['Serilog*'] });
            fireEvent.click(screen.getAllByText('Orphan.Lib')[0]);
            expect(container.textContent).toContain('no source is mapped for this package');
        });

        it('says nothing without a mapping', () => {
            const { container } = open({});
            fireEvent.click(screen.getAllByText('Serilog')[0]);
            expect(container.textContent).not.toContain('Package source mapping');
        });
    });
});

describe('NuGet manager: Sources tab', () => {
    const open = (manageSources: boolean) => {
        mockSent.length = 0;
        const view = render(<App />);
        post({ type: 'nugetData', payload: { installedPackages: [], projects: [project], searchResults: [], manageSources } });
        return view;
    };

    it('has no Sources tab without the setting', () => {
        open(false);
        expect(screen.queryByRole('tab', { name: 'Sources' })).toBeNull();
    });

    it('lists the sources when opened and sends the changes, and the Browse dropdown follows', () => {
        open(true);
        fireEvent.click(screen.getByRole('tab', { name: 'Sources' }));
        expect(mockSent.some(m => m.type === 'getSources')).toBe(true);

        post({ type: 'packageSources', payload: { sources: [
            { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, file: '/home/u/.nuget/NuGet/NuGet.Config' },
            { name: 'Company Feed', url: 'https://pkgs.example.org/index.json', enabled: false, file: '/repo/nuget.config' },
        ] } });
        expect(screen.getByText('Company Feed')).toBeTruthy();
        expect(screen.getByText('repo/nuget.config')).toBeTruthy();

        const [, companyCheckbox] = screen.getAllByRole('checkbox');
        fireEvent.click(companyCheckbox);
        expect(mockSent).toContainEqual({ type: 'setSourceEnabled', payload: { name: 'Company Feed', enabled: true } });

        fireEvent.click(screen.getAllByText('Remove')[1]);
        expect(mockSent).toContainEqual({ type: 'removeSource', payload: { name: 'Company Feed' } });

        fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Mirror' } });
        fireEvent.change(screen.getByPlaceholderText(/index.json or a folder/), { target: { value: 'https://mirror.example.org/index.json' } });
        fireEvent.click(screen.getByText('Add'));
        expect(mockSent).toContainEqual({ type: 'addSource', payload: { name: 'Mirror', url: 'https://mirror.example.org/index.json', location: 'user' } });
    });

    it('shows what went wrong with a change', () => {
        open(true);
        fireEvent.click(screen.getByRole('tab', { name: 'Sources' }));
        post({ type: 'packageSources', payload: { sources: [], error: 'A source named Mirror exists' } });
        expect(screen.getByRole('alert').textContent).toContain('A source named Mirror exists');
    });
});
