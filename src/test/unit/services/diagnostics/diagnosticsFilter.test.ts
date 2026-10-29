jest.mock('vscode', () => ({ ConfigurationTarget: { Global: 1, Workspace: 2 } }), { virtual: true });

import { readSeverityFilter, toggleSeverity } from '../../../services/diagnosticsFilter';

/** A configuration with user (global) and workspace values and the package.json defaults */
function config(global: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
        'shinobi.diagnostics.showErrors': true, 'shinobi.diagnostics.showWarnings': true, 'shinobi.diagnostics.showInfos': false,
        'shinobi.solutionExplorer.diagnostics.showInfos': false,
    };
    const updates: [string, unknown, number][] = [];
    return {
        updates,
        get: (key: string, fallback?: unknown) => key in workspace ? workspace[key] : key in global ? global[key] : defaults[key] ?? fallback,
        inspect: (key: string) => ({ key, defaultValue: defaults[key], globalValue: global[key], workspaceValue: workspace[key] }),
        update: async (key: string, value: unknown, target: number) => {
            updates.push([key, value, target]);
            (target === 2 ? workspace : global)[key] = value;
        },
        has: () => true,
    } as any;
}

describe('severity filter settings', () => {
    it('defaults to errors and warnings', () => {
        expect(readSeverityFilter(config())).toEqual({ errors: true, warnings: true, infos: false });
    });

    it('takes the old Solution Explorer infos setting until the new one is set', () => {
        expect(readSeverityFilter(config({ 'shinobi.solutionExplorer.diagnostics.showInfos': true })).infos).toBe(true);
        expect(readSeverityFilter(config({ 'shinobi.solutionExplorer.diagnostics.showInfos': true, 'shinobi.diagnostics.showInfos': false })).infos).toBe(false);
    });

    it('toggles in the user settings, or in the workspace when it sets the value', async () => {
        const user = config();
        await toggleSeverity('warnings', user);
        expect(user.updates).toEqual([['shinobi.diagnostics.showWarnings', false, 1]]);
        expect(readSeverityFilter(user).warnings).toBe(false);

        const workspace = config({}, { 'shinobi.diagnostics.showInfos': true });
        await toggleSeverity('infos', workspace);
        expect(workspace.updates).toEqual([['shinobi.diagnostics.showInfos', false, 2]]);
    });
});
