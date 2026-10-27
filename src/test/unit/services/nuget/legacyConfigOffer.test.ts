// The offer to move .nuget/NuGet.Config next to the solution (startup, and after a failed restore)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { info: [] as string[], errors: [] as string[], enabled: true, memento: {} as Record<string, unknown> };
jest.mock('vscode', () => ({
    window: {
        showInformationMessage: async (message: string) => { ui.info.push(message); return undefined; },
        showErrorMessage: async (message: string) => { ui.errors.push(message); return undefined; },
    },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => ui.enabled ?? fallback }) },
}), { virtual: true });

import { LegacyConfigOffer, offerLegacyConfigMove } from '../../../../services/nuget/legacyConfigOffer';

describe('offerLegacyConfigMove', () => {
    let dir: string;
    let solutionPath: string;
    const answers: (string | undefined)[] = [];
    const asked: string[][] = [];
    const deps = { ask: async (message: string, ...buttons: string[]) => { asked.push([message, ...buttons]); return answers.shift(); } };

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-offer-')));
        solutionPath = path.join(dir, 'App.sln');
        fs.mkdirSync(path.join(dir, '.nuget'));
        fs.writeFileSync(path.join(dir, '.nuget', 'NuGet.Config'), '<configuration><packageSources><add key="Feed" value="https://feed/index.json" /></packageSources></configuration>');
        answers.length = 0;
        asked.length = 0;
        ui.info = [];
        ui.errors = [];
        ui.enabled = true;
        ui.memento = {};
        LegacyConfigOffer.initialize({
            get: (key: string, fallback: unknown) => (ui.memento[key] ?? fallback) as never,
            update: async (key: string, value: unknown) => { ui.memento[key] = value; },
            keys: () => Object.keys(ui.memento),
        } as never);
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('asks on open and moves the file with Move', async () => {
        answers.push('Move');
        await offerLegacyConfigMove(solutionPath, 'open', deps);

        expect(asked).toHaveLength(1);
        expect(asked[0].slice(1)).toEqual(['Move', 'Copy', 'Not Now', "Don't Ask Again"]);
        expect(asked[0][0]).toContain('NU1101');
        expect(fs.existsSync(path.join(dir, 'nuget.config'))).toBe(true);
        expect(fs.existsSync(path.join(dir, '.nuget', 'NuGet.Config'))).toBe(false);
        expect(ui.info[0]).toContain('Moved to nuget.config');
    });

    it('Copy keeps the old file', async () => {
        answers.push('Copy');
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        expect(fs.existsSync(path.join(dir, 'nuget.config'))).toBe(true);
        expect(fs.existsSync(path.join(dir, '.nuget', 'NuGet.Config'))).toBe(true);
    });

    it('Not Now changes nothing and asks again next time; Don\'t Ask Again is remembered', async () => {
        answers.push('Not Now');
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        answers.push("Don't Ask Again");
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        expect(asked).toHaveLength(2);
        expect(fs.existsSync(path.join(dir, 'nuget.config'))).toBe(false);

        await offerLegacyConfigMove(solutionPath, 'open', deps);
        expect(asked).toHaveLength(2);
    });

    it('asks nothing when there is a nuget.config already, no legacy file, or the setting is off', async () => {
        ui.enabled = false;
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        ui.enabled = true;
        fs.writeFileSync(path.join(dir, 'nuget.config'), '<configuration />');
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        fs.rmSync(path.join(dir, 'nuget.config'));
        fs.rmSync(path.join(dir, '.nuget'), { recursive: true });
        await offerLegacyConfigMove(solutionPath, 'open', deps);
        expect(asked).toHaveLength(0);
    });

    it('after a failed restore it asks once per session, also with the setting off', async () => {
        ui.enabled = false;
        answers.push('Not Now');
        await offerLegacyConfigMove(solutionPath, 'restoreFailed', deps);
        await offerLegacyConfigMove(solutionPath, 'restoreFailed', deps);
        expect(asked).toHaveLength(1);
        expect(asked[0][0]).toContain('restore or build failed');
    });
});
