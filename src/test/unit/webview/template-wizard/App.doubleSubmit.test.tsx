// Enter twice, or Enter and the button, sends one create request (review A3-11)
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../../../webview/template-wizard/App';
import { WizardInit, WizardRequest, WizardTemplate } from '../../../../types/templateWizard';

const classlib: WizardTemplate = { id: 'cl', name: 'Class Library', shortName: 'classlib', language: 'C#', description: 'd', tags: ['Common'], defaultName: 'ClassLibrary1', needsName: true, options: [] };
const init: WizardInit = { kind: 'project', title: 'Add New Project', templates: [classlib], location: 'src', preferredValues: {} };
const post = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data })); });

const setup = () => {
    const sent: WizardRequest[] = [];
    render(<App api={{ postMessage: message => sent.push(message) }} />);
    post({ type: 'init', payload: init });
    fireEvent.click(screen.getByText('Class Library'));
    fireEvent.click(screen.getByText('Next'));
    return { sent, name: screen.getByLabelText('Project name') };
};
const creates = (sent: WizardRequest[]) => sent.filter(message => message.type === 'create').length;

describe('template wizard', () => {
    it('sends one create request for Enter, Enter and a click before the host answers', () => {
        const { sent, name } = setup();
        fireEvent.keyDown(name, { key: 'Enter' });
        fireEvent.keyDown(name, { key: 'Enter' });
        fireEvent.click(screen.getByText('Create'));
        expect(creates(sent)).toBe(1);
    });

    it('can create again after the host reported an error', () => {
        const { sent, name } = setup();
        fireEvent.keyDown(name, { key: 'Enter' });
        post({ type: 'busy', busy: true });
        post({ type: 'error', message: 'folder is not empty' });
        post({ type: 'busy', busy: false });
        fireEvent.keyDown(name, { key: 'Enter' });
        expect(creates(sent)).toBe(2);
    });
});
