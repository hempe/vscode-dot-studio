import * as vscode from 'vscode';

/** Which severities the Error List lists and the Solution Explorer marks: shared settings */
export interface SeverityFilter {
    readonly errors: boolean;
    readonly warnings: boolean;
    readonly infos: boolean;
}

export type FilterSeverity = keyof SeverityFilter;
export const FILTER_SEVERITIES: readonly FilterSeverity[] = ['errors', 'warnings', 'infos'];

const SECTION = 'shinobi.diagnostics';
const KEYS: Record<FilterSeverity, string> = { errors: 'showErrors', warnings: 'showWarnings', infos: 'showInfos' };
/** Before the Error List shared its toggles, only infos had a setting, for the Solution Explorer */
const LEGACY_SHOW_INFOS = 'shinobi.solutionExplorer.diagnostics.showInfos';

const isSet = (inspected: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined) =>
    inspected !== undefined && (inspected.globalValue !== undefined || inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined);

export function readSeverityFilter(config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration()): SeverityFilter {
    const infosKey = `${SECTION}.${KEYS.infos}`;
    const infos = !isSet(config.inspect(infosKey)) && isSet(config.inspect(LEGACY_SHOW_INFOS))
        ? config.get<boolean>(LEGACY_SHOW_INFOS, false)
        : config.get<boolean>(infosKey, false);
    return {
        errors: config.get<boolean>(`${SECTION}.${KEYS.errors}`, true),
        warnings: config.get<boolean>(`${SECTION}.${KEYS.warnings}`, true),
        infos,
    };
}

/** Flips a severity where its setting lives: the workspace if it sets it, otherwise the user settings */
export async function toggleSeverity(severity: FilterSeverity, config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration()): Promise<void> {
    const key = `${SECTION}.${KEYS[severity]}`;
    const inspected = config.inspect(key);
    const target = inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(key, !readSeverityFilter(config)[severity], target);
}

export function affectsSeverityFilter(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration(SECTION) || event.affectsConfiguration(LEGACY_SHOW_INFOS);
}
