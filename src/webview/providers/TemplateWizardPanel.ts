import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { WizardInit, WizardMessage, WizardRequest } from '../../types/templateWizard';
import { TemplateWizardWebview } from './views/TemplateWizardWebview';
import { createItem, createNewSolution, createProject, newItemWizard, newProjectWizard, newSolutionWizard } from '../../services/templates/templateService';

const log = logger('TemplateWizard');

type CreateRequest = Extract<WizardRequest, { type: 'create' }>;

/** The Add New Project / Add New Item wizard: a webview in an editor tab, like Visual Studio's dialogs */
export class TemplateWizardPanel {
    static extensionUri: vscode.Uri | undefined;

    /** Opens the wizard; `create` returns an error message, which keeps the wizard open */
    static open(title: string, init: () => Promise<WizardInit>, create: (request: CreateRequest) => Promise<string | undefined>): void {
        if (!this.extensionUri) {
            log.error('TemplateWizardPanel.extensionUri is not set');
            return;
        }
        const panel = vscode.window.createWebviewPanel('shinobi.templateWizard', title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        });
        panel.webview.html = TemplateWizardWebview.getHtmlForWebview(this.extensionUri, panel.webview, title);
        const post = (message: WizardMessage) => panel.webview.postMessage(message);

        panel.webview.onDidReceiveMessage(async (request: WizardRequest) => {
            switch (request.type) {
                case 'ready':
                    try {
                        await post({ type: 'init', payload: await init() });
                    } catch (error) {
                        log.error('Loading templates failed:', error);
                        await post({ type: 'error', message: `Loading the templates failed: ${error}` });
                    }
                    break;
                case 'create': {
                    await post({ type: 'busy', busy: true });
                    let error: string | undefined;
                    try {
                        error = await create(request);
                    } catch (e) {
                        log.error('Creating from template failed:', e);
                        error = String(e);
                    }
                    if (error) {
                        await post({ type: 'error', message: error });
                        await post({ type: 'busy', busy: false });
                    } else {
                        panel.dispose();
                    }
                    break;
                }
                case 'browseFolder': {
                    const [folder] = await vscode.window.showOpenDialog({
                        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
                        defaultUri: request.current ? vscode.Uri.file(request.current) : undefined,
                        openLabel: 'Select Folder',
                    }) ?? [];
                    if (folder) {
                        await post({ type: 'folderPicked', path: folder.fsPath });
                    }
                    break;
                }
                case 'cancel':
                    panel.dispose();
                    break;
            }
        });
    }
}

/** "Add New Project...": into the solution root, or a solution folder ("a/b") */
export function openNewProjectWizard(solutionFolderPath?: string): void {
    TemplateWizardPanel.open(
        'Add New Project',
        () => newProjectWizard(solutionFolderPath),
        async request => {
            const error = await createProject(request.templateId, request.name.trim(), request.location ?? request.name, request.values, solutionFolderPath);
            return error;
        });
}

/** "Add New Item..." in `folder` of `projectPath`; the new file opens */
export function openNewItemWizard(folder: string, projectPath: string): void {
    TemplateWizardPanel.open(
        `Add New Item: ${path.basename(folder)}`,
        () => newItemWizard(folder, projectPath),
        async request => {
            const result = await createItem(request.templateId, folder, request.name.trim(), projectPath, request.values);
            if (result.file) {
                await vscode.window.showTextDocument(vscode.Uri.file(result.file));
            }
            return result.error;
        });
}

/** Visual Studio's "Create a new project": a new solution with its first project, which then opens */
export function openNewSolutionWizard(): void {
    TemplateWizardPanel.open('Create a New Project', newSolutionWizard, request => createNewSolution(request));
}

