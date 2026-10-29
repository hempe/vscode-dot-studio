// When MSBuild cannot evaluate the UserSecretsId, no new id is written (review A6-5)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ui = { errors: [] as string[], shown: [] as string[] };
jest.mock('vscode', () => ({
    window: {
        showErrorMessage: (message: string) => { ui.errors.push(message); },
        showTextDocument: async (uri: { fsPath: string }) => { ui.shown.push(uri.fsPath); },
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });

import { manageUserSecrets } from '../../../../services/project/userSecrets';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;

describe('manageUserSecrets when the id cannot be evaluated', () => {
    let dir: string;
    beforeEach(() => {
        ui.errors = [];
        ui.shown = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-secrets-')));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    withDotnet('leaves the project file alone, so the id of a Directory.Build.props is not shadowed', async () => {
        // An SDK that is not installed: MSBuild cannot evaluate the project
        fs.writeFileSync(path.join(dir, 'global.json'), '{ "sdk": { "version": "9.0.999", "rollForward": "disable" } }');
        fs.writeFileSync(path.join(dir, 'Directory.Build.props'), '<Project><PropertyGroup><UserSecretsId>shared-team-id</UserSecretsId></PropertyGroup></Project>');
        const projectPath = path.join(dir, 'Web.csproj');
        const content = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>';
        fs.writeFileSync(projectPath, content);

        await manageUserSecrets(projectPath);

        expect(fs.readFileSync(projectPath, 'utf8')).toBe(content);
        expect(ui.errors).toEqual([expect.stringContaining('No new id was added')]);
        expect(ui.shown).toEqual([]);
    }, 90000);
});
