// The README shown is the one of the selected package (review A3-5)
import { act, render } from '@testing-library/react';
import NugetReadme from '../../../../webview/nuget-view/components/NugetReadme';

describe('NugetReadme', () => {
    it('a slow answer of an earlier package does not replace the README of the selected one', async () => {
        const pending: Record<string, (body: string) => void> = {};
        (global as any).fetch = jest.fn((url: string) => new Promise(resolve => {
            pending[url] = (body: string) => resolve({ ok: true, status: 200, text: async () => body });
        }));
        const { container, rerender } = render(<NugetReadme packageId="A" version="1" readmeUrl="https://api.nuget.org/A" />);
        rerender(<NugetReadme packageId="B" version="1" readmeUrl="https://api.nuget.org/B" />);

        await act(async () => { pending['https://api.nuget.org/B']('README OF B'); });
        await act(async () => { pending['https://api.nuget.org/A']('README OF A'); });

        expect(container.textContent).toContain('README OF B');
        expect(container.textContent).not.toContain('README OF A');
    });

    it('the error of the previous package does not stay for a package without a README', async () => {
        (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => '' }));
        const { container, rerender } = render(<NugetReadme packageId="A" version="1" readmeUrl="https://api.nuget.org/A" />);
        await act(async () => { });
        expect(container.textContent).toContain('Failed to fetch README: 500');

        rerender(<NugetReadme packageId="C" version="1" readmeUrl={undefined} />);
        await act(async () => { });

        expect(container.textContent).not.toContain('Failed to fetch');
        expect(container.textContent).toContain('No README available');
    });
});
