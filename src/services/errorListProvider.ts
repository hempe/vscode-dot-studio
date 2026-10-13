import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsService, FileDiagnostics, ListedDiagnostic } from './diagnosticsService';
import { buildErrorList, ErrorListFilter, ErrorListProject, ErrorListSummary, summarizeErrorList } from './errorList';
import { SolutionService } from './solutionService';

export const ERROR_LIST_VIEW = 'shinobi.errorList';
const FILTER_STATE_KEY = 'shinobi.errorList.filter';

export type ErrorListSeverity = keyof ErrorListFilter;
export const ERROR_LIST_SEVERITIES: readonly ErrorListSeverity[] = ['errors', 'warnings', 'messages'];

/** Context key that tells the view title which toggle (show/hide) to offer */
export const shownContextKey = (severity: ErrorListSeverity) => `shinobi.errorList.${severity}Shown`;

const ALL_SHOWN: ErrorListFilter = { errors: true, warnings: true, messages: true };

const SEVERITY_ICONS: Record<ListedDiagnostic['severity'], [icon: string, color: string]> = {
    error: ['error', 'problemsErrorIcon.foreground'],
    warning: ['warning', 'problemsWarningIcon.foreground'],
    info: ['info', 'problemsInfoIcon.foreground'],
};

export type ErrorListNode =
    | { readonly kind: 'project'; readonly project: ErrorListProject }
    | { readonly kind: 'file'; readonly file: FileDiagnostics }
    | { readonly kind: 'diagnostic'; readonly file: FileDiagnostics; readonly diagnostic: ListedDiagnostic };

/** Visual Studio–style Error List: errors, warnings and messages grouped by project and file */
export class ErrorListProvider implements vscode.TreeDataProvider<ErrorListNode>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _filter: ErrorListFilter;
    private _view?: vscode.TreeView<ErrorListNode>;
    private readonly _listener: vscode.Disposable;

    constructor(
        private readonly _diagnostics: Pick<DiagnosticsService, 'files' | 'onDidChange'>,
        private readonly _state: vscode.Memento
    ) {
        this._filter = { ...ALL_SHOWN, ...this._state.get<Partial<ErrorListFilter>>(FILTER_STATE_KEY) };
        this._listener = this._diagnostics.onDidChange(() => this.refresh());
    }

    attach(view: vscode.TreeView<ErrorListNode>): void {
        this._view = view;
        this.refresh();
    }

    async toggle(severity: ErrorListSeverity): Promise<void> {
        this._filter = { ...this._filter, [severity]: !this._filter[severity] };
        await this._state.update(FILTER_STATE_KEY, this._filter);
        this.refresh();
    }

    refresh(): void {
        for (const severity of ERROR_LIST_SEVERITIES) {
            vscode.commands.executeCommand('setContext', shownContextKey(severity), this._filter[severity]);
        }
        this._updateView();
        this._onDidChangeTreeData.fire();
    }

    getChildren(node?: ErrorListNode): ErrorListNode[] {
        if (!node) {
            return this._projects().map(project => ({ kind: 'project', project }));
        }
        switch (node.kind) {
            case 'project': return node.project.files.map(file => ({ kind: 'file', file }));
            case 'file': return node.file.diagnostics.map(diagnostic => ({ kind: 'diagnostic', file: node.file, diagnostic }));
            case 'diagnostic': return [];
        }
    }

    getTreeItem(node: ErrorListNode): vscode.TreeItem {
        switch (node.kind) {
            case 'project': {
                const item = new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.Expanded);
                item.id = `project:${node.project.name}`;
                item.iconPath = new vscode.ThemeIcon('project');
                item.description = String(node.project.files.reduce((sum, file) => sum + file.diagnostics.length, 0));
                return item;
            }
            case 'file': {
                // A resourceUri label gets the file icon of the user's icon theme
                const item = new vscode.TreeItem(node.file.uri, vscode.TreeItemCollapsibleState.Expanded);
                item.id = `file:${node.file.uri.fsPath}`;
                item.iconPath = vscode.ThemeIcon.File;
                item.description = String(node.file.diagnostics.length);
                return item;
            }
            case 'diagnostic': {
                const { severity, message, code, range } = node.diagnostic;
                const [icon, color] = SEVERITY_ICONS[severity];
                const position = `(${range.start.line + 1}, ${range.start.character + 1})`;
                const item = new vscode.TreeItem(message.split('\n')[0], vscode.TreeItemCollapsibleState.None);
                item.id = `diagnostic:${node.file.uri.fsPath}:${severity}:${range.start.line}:${range.start.character}:${code ?? ''}:${message}`;
                item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
                item.description = code ? `${code} ${position}` : position;
                item.tooltip = message;
                item.command = {
                    command: 'vscode.open',
                    title: 'Go to Diagnostic',
                    arguments: [node.file.uri, { selection: range }],
                };
                return item;
            }
        }
    }

    dispose(): void {
        this._listener.dispose();
        this._onDidChangeTreeData.dispose();
    }

    private _projects(): ErrorListProject[] {
        const projectPaths = [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])];
        const projects = projectPaths.map(projectPath => ({ name: path.basename(projectPath, path.extname(projectPath)), path: projectPath }));
        return buildErrorList(this._diagnostics.files, projects, this._filter);
    }

    private _updateView(): void {
        if (!this._view) {
            return;
        }
        const summary = summarizeErrorList(this._diagnostics.files);
        this._view.description = describe(summary);
        this._view.badge = summary.errors ? { value: summary.errors, tooltip: plural(summary.errors, 'error') } : undefined;

        const hidden: ErrorListSummary = {
            errors: this._filter.errors ? 0 : summary.errors,
            warnings: this._filter.warnings ? 0 : summary.warnings,
            messages: this._filter.messages ? 0 : summary.messages,
        };
        const visible = summary.errors + summary.warnings + summary.messages - hidden.errors - hidden.warnings - hidden.messages;
        this._view.message = visible > 0
            ? undefined
            : hidden.errors + hidden.warnings + hidden.messages > 0
                ? `${describe(hidden, true)} hidden by the filter.`
                : 'No errors, warnings or messages. Build the solution to check every file.';
    }
}

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function describe(summary: ErrorListSummary, skipZero = false): string {
    return ([['errors', 'error'], ['warnings', 'warning'], ['messages', 'message']] as const)
        .filter(([key]) => !skipZero || summary[key] > 0)
        .map(([key, word]) => plural(summary[key], word))
        .join(', ');
}
