import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { choices: [] as (string | undefined)[], messages: [] as string[], offerDisabled: false };
const state = new Map<string, unknown>();

jest.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'offerSlnxConversion' && ui.offerDisabled ? false : fallback }) },
    window: {
        showInformationMessage: async (message: string, ...items: any[]) => {
            ui.messages.push(message);
            const choice = ui.choices.shift();
            return items.find(item => item === choice);
        },
        showWarningMessage: async (message: string, ...items: any[]) => {
            ui.messages.push(message);
            const choice = ui.choices.shift();
            return items.find(item => item === choice);
        },
        showErrorMessage: async (message: string) => { ui.messages.push(message); },
    },
}), { virtual: true });

import { offerSlnxMigration, SlnxMigration } from '../../../services/slnxMigration';

describe('offering to convert a .sln to .slnx', () => {
    let dir: string;
    let sln: string;
    let opened: string[];
    let migrated: string[];
    const deps = () => ({
        migrate: async (solutionPath: string) => {
            migrated.push(solutionPath);
            fs.writeFileSync(solutionPath.replace(/\.sln$/, '.slnx'), '<Solution />');
        },
        open: async (solutionPath: string) => { opened.push(solutionPath); },
    });

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slnx-'));
        sln = path.join(dir, 'App.sln');
        fs.writeFileSync(sln, 'Microsoft Visual Studio Solution File, Format Version 12.00');
        ui.choices = [];
        ui.messages = [];
        ui.offerDisabled = false;
        opened = [];
        migrated = [];
        state.clear();
        SlnxMigration.initialize({ get: (key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback, update: async (key: string, value: unknown) => { state.set(key, value); } } as any);
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('converts, deletes the .sln when confirmed, and opens the .slnx', async () => {
        ui.choices = ['Convert', 'Delete App.sln'];

        await offerSlnxMigration(sln, deps());

        expect(ui.messages[0]).toMatch(/App\.sln uses the old solution format/);
        expect(migrated).toEqual([sln]);
        expect(fs.existsSync(sln)).toBe(false);
        expect(opened).toEqual([path.join(dir, 'App.slnx')]);
    });

    it('can keep the .sln for teammates on older Visual Studio versions', async () => {
        ui.choices = ['Convert', 'Keep Both'];

        await offerSlnxMigration(sln, deps());

        expect(fs.existsSync(sln)).toBe(true);
        expect(opened).toEqual([path.join(dir, 'App.slnx')]);
        expect(ui.messages[1]).toMatch(/older Visual Studio/);
    });

    it('asks again next time after "Not Now", never after "Don\'t Ask Again"', async () => {
        ui.choices = ['Not Now'];
        await offerSlnxMigration(sln, deps());
        ui.choices = ["Don't Ask Again"];
        await offerSlnxMigration(sln, deps());
        await offerSlnxMigration(sln, deps());

        expect(ui.messages).toHaveLength(2);
        expect(migrated).toEqual([]);
    });

    it('leaves .slnx solutions alone, and .sln files that have a .slnx next to them', async () => {
        await offerSlnxMigration(path.join(dir, 'Other.slnx'), deps());
        fs.writeFileSync(path.join(dir, 'App.slnx'), '<Solution />');
        await offerSlnxMigration(sln, deps());

        expect(ui.messages).toEqual([]);
    });

    it('reports a failed conversion and keeps the .sln', async () => {
        ui.choices = ['Convert'];

        await offerSlnxMigration(sln, { ...deps(), migrate: async () => { throw new Error('Unknown command: migrate'); } });

        expect(fs.existsSync(sln)).toBe(true);
        expect(ui.messages[1]).toMatch(/Unknown command: migrate/);
        expect(ui.messages[1]).toMatch(/9\.0\.200/);
        expect(opened).toEqual([]);
    });

    it('stays quiet when shinobi.solution.offerSlnxConversion is off', async () => {
        ui.offerDisabled = true;
        await offerSlnxMigration(sln, deps());
        expect(ui.messages).toEqual([]);
    });
});
