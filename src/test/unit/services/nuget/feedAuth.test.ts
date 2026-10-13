import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { warnings: [] as string[], choices: [] as (string | undefined)[], inputs: [] as string[], infos: [] as string[], opened: [] as string[] };
const workspace = { dir: '' };

jest.mock('vscode', () => ({
    workspace: { get workspaceFolders() { return [{ uri: { fsPath: workspace.dir } }]; } },
    window: {
        showWarningMessage: async (message: string) => { ui.warnings.push(message); return ui.choices.shift(); },
        showInputBox: async () => ui.inputs.shift(),
        showInformationMessage: async (message: string) => { ui.infos.push(message); },
        showErrorMessage: async (message: string) => { ui.infos.push(message); },
        showTextDocument: async (uri: { fsPath: string }) => { ui.opened.push(uri.fsPath); },
    },
    env: { openExternal: async () => true },
    Uri: { file: (p: string) => ({ fsPath: p }), parse: (u: string) => u },
    Position: class { constructor(public line: number, public character: number) { } },
    Range: class { constructor(public start: unknown, public end: unknown) { } },
}), { virtual: true });

jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { basicAuth, reportRejectedCredentials, reportRejectedInOutput, setFeedSources } from '../../../../services/nuget/feedAuth';
import { readSourceCredential } from '../../../../services/nuget/nugetCredentials';

describe('rejected feed credentials', () => {
    let configFile: string;

    let token = 0;

    beforeEach(() => {
        token++;
        Object.assign(ui, { warnings: [], choices: [], inputs: [], infos: [], opened: [] });
        workspace.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedauth-'));
        configFile = path.join(workspace.dir, 'nuget.config');
        fs.writeFileSync(configFile, `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="Contoso" value="https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <Contoso>
      <add key="Username" value="me" />
      <add key="ClearTextPassword" value="expired-${token}" />
    </Contoso>
  </packageSourceCredentials>
</configuration>
`);
        setFeedSources(async () => [{ name: 'Contoso', url: 'https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', enabled: true, isLocal: false }]);
    });

    afterEach(() => fs.rmSync(workspace.dir, { recursive: true, force: true }));

    it('names the feed and the file, and stores a new token there', async () => {
        ui.choices = ['Enter New Token...'];
        ui.inputs = ['me', 'fresh'];
        await reportRejectedCredentials('https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/query2?q=x', 401);

        expect(ui.warnings).toEqual(["NuGet feed 'Contoso' rejected its credentials (401 Unauthorized): the token in nuget.config has probably expired."]);
        expect(readSourceCredential('Contoso', workspace.dir)).toMatchObject({ kind: 'clearText', file: configFile, username: 'me', password: 'fresh' });
        expect(ui.infos[0]).toMatch(/^Saved the token for 'Contoso'/);
    });

    it('reports the same problem once a minute, and opens the config at the token', async () => {
        ui.choices = ['Open NuGet.Config'];
        await reportRejectedCredentials('https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', 401);
        await reportRejectedCredentials('https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', 401);
        expect(ui.warnings).toHaveLength(1);
        expect(ui.opened).toEqual([configFile]);

        const now = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(now + 61000);
        await reportRejectedCredentials('https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', 401);
        expect(ui.warnings).toHaveLength(2);
        jest.restoreAllMocks();
    });

    it('finds rejected feeds in dotnet output', async () => {
        fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8'));
        await reportRejectedInOutput('error NU1301: Unable to load the service index for source https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json.\n  Response status code does not indicate success: 401 (Unauthorized).');
        expect(ui.warnings).toEqual([expect.stringContaining("NuGet feed 'Contoso' rejected its credentials (401 Unauthorized)")]);
    });

    it('sends what NuGet sends: Basic with user name and password', () => {
        expect(basicAuth({ kind: 'clearText', file: 'f', line: 1, username: 'me', password: 'pat' })).toBe(Buffer.from('me:pat').toString('base64'));
        expect(basicAuth({ kind: 'none' })).toBeUndefined();
    });
});
