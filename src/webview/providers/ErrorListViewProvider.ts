import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsService } from '../../services/diagnostics/diagnosticsService';
import { buildErrorRows, summarizeErrorList } from '../../services/diagnostics/errorList';
import { affectsSeverityFilter, readSeverityFilter, toggleSeverity } from '../../services/diagnostics/diagnosticsFilter';
import { SolutionService } from '../../services/solution/solutionService';
import { ErrorListMessage, ErrorListRequest } from '../../types/errorList';
import { ErrorListWebview } from './views/ErrorListWebview';

export const ERROR_LIST_VIEW = 'shinobi.errorList';

/** Visual Studio–style Error List: a table of errors, warnings and messages in the panel */
export class ErrorListViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private _view?: vscode.WebviewView;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _diagnostics: Pick<DiagnosticsService, 'files' | 'onDidChange'>
    ) {
        this._disposables.push(
            this._diagnostics.onDidChange(() => this.refresh()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (affectsSeverityFilter(event)) {
                    this.refresh();
                }
            })
        );
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this._view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out', 'webview')] };
        view.webview.html = ErrorListWebview.getHtmlForWebview(this._extensionUri, view.webview);
        view.webview.onDidReceiveMessage((request: ErrorListRequest) => this._handle(request), undefined, this._disposables);
        this._updateBadge();
    }

    refresh(): void {
        this._updateBadge();
        if (!this._view) {
            return;
        }
        const projects = [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])]
            .map(projectPath => ({ name: path.basename(projectPath, path.extname(projectPath)), path: projectPath }));
        const message: ErrorListMessage = {
            type: 'rows',
            rows: buildErrorRows(this._diagnostics.files, projects),
            filter: readSeverityFilter(),
            summary: summarizeErrorList(this._diagnostics.files),
            hasSolution: projects.length > 0,
        };
        void this._view.webview.postMessage(message);
    }

    private async _handle(request: ErrorListRequest): Promise<void> {
        switch (request.type) {
            case 'ready':
                this.refresh();
                break;
            case 'open': {
                const position = new vscode.Position(request.line - 1, request.column - 1);
                await vscode.window.showTextDocument(vscode.Uri.file(request.filePath), { selection: new vscode.Range(position, position) });
                break;
            }
            case 'toggle':
                await toggleSeverity(request.severity);
                break;
            case 'openUrl':
                if (/^https?:\/\//i.test(request.url)) {
                    await vscode.env.openExternal(vscode.Uri.parse(request.url));
                }
                break;
        }
    }

    private _updateBadge(): void {
        if (this._view) {
            const { errors } = summarizeErrorList(this._diagnostics.files);
            this._view.badge = errors ? { value: errors, tooltip: `${errors} error${errors === 1 ? '' : 's'}` } : undefined;
        }
    }

    dispose(): void {
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
