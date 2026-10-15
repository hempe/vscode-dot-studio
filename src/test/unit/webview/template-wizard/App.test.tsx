import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App, initialValues } from '../../../../webview/template-wizard/App';
import { WizardInit, WizardMessage, WizardRequest, WizardTemplate } from '../../../../types/templateWizard';

const webapi: WizardTemplate = {
    id: 'Microsoft.Web.WebApi.CSharp.10.0', name: 'ASP.NET Core Web API', shortName: 'webapi', language: 'C#',
    description: 'A project template for creating a RESTful Web API', tags: ['Web', 'Web API'], defaultName: 'WebApplication', needsName: true,
    options: [
        { name: 'framework', symbol: 'Framework', type: 'choice', label: 'The target framework', defaultValue: 'net10.0', choices: [{ value: 'net10.0', description: 'Target net10.0' }, { value: 'net8.0', description: 'Target net8.0' }] },
        { name: 'use-controllers', symbol: 'UseControllers', type: 'bool', label: 'Whether to use controllers', defaultValue: 'false' },
        { name: 'client-id', symbol: 'ClientId', type: 'text', label: 'The Client ID', defaultValue: '1111' },
    ],
};
const classlib: WizardTemplate = {
    id: 'Microsoft.Common.Library.CSharp.10.0', name: 'Class Library', shortName: 'classlib', language: 'C#', recent: true,
    description: 'A project for creating a class library', tags: ['Common', 'Library'], defaultName: 'ClassLibrary1', needsName: true, options: [],
};
const projectInit: WizardInit = { kind: 'project', title: 'Add New Project', templates: [classlib, webapi], location: 'src', preferredValues: { framework: 'net8.0' } };

const templateNames = () => within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.firstChild?.textContent);

function renderWizard(init: WizardInit) {
    const sent: WizardRequest[] = [];
    render(<App api={{ postMessage: message => sent.push(message) }} />);
    const receive = (message: WizardMessage) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
    receive({ type: 'init', payload: init });
    return { sent, receive };
}

describe('template wizard', () => {
    it('asks for its data when it opens', () => {
        const sent: WizardRequest[] = [];
        render(<App api={{ postMessage: message => sent.push(message) }} />);
        expect(sent).toEqual([{ type: 'ready' }]);
        expect(screen.getByText('Loading templates...')).toBeInTheDocument();
    });

    it('lists recent templates first and filters by search', () => {
        renderWizard(projectInit);
        expect(screen.getByText('Recently used')).toBeInTheDocument();
        expect(templateNames()).toEqual(['Class Library', 'ASP.NET Core Web API']);

        fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'restful' } });
        expect(templateNames()).toEqual(['ASP.NET Core Web API']);
    });

    it('configures a project and creates it with its options', () => {
        const { sent } = renderWizard(projectInit);
        fireEvent.click(screen.getByText('ASP.NET Core Web API'));
        expect(screen.getByText('A project template for creating a RESTful Web API')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Next'));

        expect(screen.getByLabelText('Project name')).toHaveValue('WebApplication');
        expect(screen.getByLabelText('Location')).toHaveValue('src/WebApplication');
        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Orders.Api' } });
        expect(screen.getByLabelText('Location')).toHaveValue('src/Orders.Api');
        expect(screen.getByLabelText('framework')).toHaveValue('net8.0');
        expect(screen.getByText('More options (1)')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/Whether to use controllers/));
        fireEvent.click(screen.getByText('Create'));

        expect(sent[sent.length - 1]).toEqual({
            type: 'create', templateId: webapi.id, name: 'Orders.Api', location: 'src/Orders.Api',
            values: { framework: 'net8.0', 'use-controllers': true, 'client-id': '1111' },
        });
    });

    it('keeps an edited location when the name changes', () => {
        renderWizard(projectInit);
        fireEvent.doubleClick(screen.getByText('Class Library'));
        fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'libs/Core' } });
        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Core' } });
        expect(screen.getByLabelText('Location')).toHaveValue('libs/Core');
    });

    it('adds items from one page; config templates need no name', () => {
        const editorconfig: WizardTemplate = { id: 'editorconfig', name: 'EditorConfig file', tags: ['Config'], description: '', defaultName: 'EditorConfig', needsName: false, options: [] };
        const cls: WizardTemplate = { id: 'builtin:class', name: 'Class', language: 'C#', tags: ['Code'], description: 'An empty class', defaultName: 'Class1.cs', needsName: true, options: [] };
        const { sent, receive } = renderWizard({ kind: 'item', title: 'Add New Item to Models', templates: [cls, editorconfig], location: '/p/Models', preferredValues: {} });

        fireEvent.click(screen.getByText('EditorConfig file'));
        expect(screen.queryByLabelText('Name')).toBeNull();
        fireEvent.click(screen.getByText('Class'));
        expect(screen.getByLabelText('Name')).toHaveValue('Class1.cs');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Customer' } });
        fireEvent.click(screen.getByText('Add'));
        expect(sent[sent.length - 1]).toEqual({ type: 'create', templateId: 'builtin:class', name: 'Customer', values: {} });

        receive({ type: 'error', message: 'Customer.cs already exists.' });
        expect(screen.getByRole('alert')).toHaveTextContent('Customer.cs already exists.');
    });
});

describe('initialValues', () => {
    it('prefers wizard values the option allows, else the defaults', () => {
        expect(initialValues(webapi, { framework: 'net8.0' })).toEqual({ framework: 'net8.0', 'use-controllers': false, 'client-id': '1111' });
        expect(initialValues(webapi, { framework: 'net6.0' }).framework).toBe('net10.0');
    });

    it('creates a new solution with its first project, like Visual Studio\'s "Create a new project"', () => {
        const { sent, receive } = renderWizard({ ...projectInit, title: 'Create a New Project', location: '/home/me/source', newSolution: true });
        fireEvent.doubleClick(screen.getByText('ASP.NET Core Web API'));

        expect(screen.getByLabelText('Location')).toHaveValue('/home/me/source');
        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Shop.Api' } });
        // The solution name follows the project name until it is edited
        expect(screen.getByLabelText('Solution name')).toHaveValue('Shop.Api');
        fireEvent.change(screen.getByLabelText('Solution name'), { target: { value: 'Shop' } });
        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Shop.Web' } });
        expect(screen.getByLabelText('Solution name')).toHaveValue('Shop');

        fireEvent.click(screen.getByText('Browse...'));
        expect(sent[sent.length - 1]).toEqual({ type: 'browseFolder', current: '/home/me/source' });
        receive({ type: 'folderPicked', path: '/home/me/repos' });
        fireEvent.click(screen.getByText('Create'));

        expect(sent[sent.length - 1]).toEqual(expect.objectContaining({
            type: 'create', name: 'Shop.Web', location: '/home/me/repos', solutionName: 'Shop', sameDirectory: false,
        }));
    });

    it('places solution and project in one folder when asked', () => {
        const { sent } = renderWizard({ ...projectInit, location: '/src', newSolution: true });
        fireEvent.doubleClick(screen.getByText('Class Library'));
        fireEvent.click(screen.getByLabelText('Place solution and project in the same directory'));

        expect(screen.getByLabelText('Solution name')).toBeDisabled();
        fireEvent.click(screen.getByText('Create'));
        expect(sent[sent.length - 1]).toEqual(expect.objectContaining({ location: '/src', sameDirectory: true }));
    });
});

