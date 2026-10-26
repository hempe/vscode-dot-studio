// A failed load says why, and does not start another full load with every message (review A3-6)
import { act, render } from '@testing-library/react';

const posted: any[] = [];
(global as any).acquireVsCodeApi = () => ({ postMessage: (message: any) => posted.push(message) });

import { App } from '../../../../webview/solution-view/App';

const post = (data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data })); });
const requests = () => posted.filter(message => message.type === 'getSolutionData').length;

describe('Solution Explorer after a failed load', () => {
    it('shows the reason and asks only once', () => {
        render(<App />);
        const atStart = requests();
        expect(atStart).toBe(1);

        post({ type: 'error', payload: { message: 'Failed to load solution data' } });
        post({ type: 'iconTheme', payload: { theme: null } });
        post({ type: 'activeFileChanged', payload: { filePath: '/a.cs' } });

        expect(requests()).toBe(atStart);
        expect(document.body.textContent).toContain('Could not load the solution: Failed to load solution data');
    });
});
