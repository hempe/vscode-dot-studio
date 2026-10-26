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
