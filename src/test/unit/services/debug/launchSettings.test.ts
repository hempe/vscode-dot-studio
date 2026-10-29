jest.mock('vscode', () => ({}), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defaultLaunchSettings, ensureLaunchSettings } from '../../../services/launchSettings';

describe('launch settings', () => {
    it('web projects get http and https profiles like `dotnet new web`', () => {
        expect(JSON.parse(defaultLaunchSettings('Shop.Web', true, { http: 5123, https: 7234 }))).toEqual({
            $schema: 'https://json.schemastore.org/launchsettings.json',
            profiles: {
                http: {
                    commandName: 'Project',
                    dotnetRunMessages: true,
                    launchBrowser: true,
                    applicationUrl: 'http://localhost:5123',
                    environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
                },
                https: {
                    commandName: 'Project',
                    dotnetRunMessages: true,
                    launchBrowser: true,
                    applicationUrl: 'https://localhost:7234;http://localhost:5123',
                    environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
                },
            },
        });
    });

    it('other projects get one profile named after the project, like `dotnet new worker`', () => {
        expect(JSON.parse(defaultLaunchSettings('Shop.Worker', false, { http: 5123, https: 7234 }))).toEqual({
            $schema: 'https://json.schemastore.org/launchsettings.json',
            profiles: {
                'Shop.Worker': {
                    commandName: 'Project',
                    dotnetRunMessages: true,
                    environmentVariables: { DOTNET_ENVIRONMENT: 'Development' },
                },
            },
        });
    });

    it('picks ports in the ranges dotnet new uses', () => {
        for (let i = 0; i < 20; i++) {
            const { profiles } = JSON.parse(defaultLaunchSettings('App', true));
            expect(Number(profiles.http.applicationUrl.split(':')[2])).toBeGreaterThanOrEqual(5000);
            expect(Number(profiles.http.applicationUrl.split(':')[2])).toBeLessThan(5300);
            expect(Number(/:(\d+);/.exec(profiles.https.applicationUrl)![1])).toBeGreaterThanOrEqual(7000);
            expect(Number(/:(\d+);/.exec(profiles.https.applicationUrl)![1])).toBeLessThan(7300);
        }
    });

    describe('ensureLaunchSettings', () => {
        let dir: string;
        beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'launch-settings-'))); });
        afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('creates Properties/launchSettings.json for a project without one', async () => {
            const projectPath = path.join(dir, 'Api.csproj');
            fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');

            const file = await ensureLaunchSettings(projectPath);

            expect(file).toBe(path.join(dir, 'Properties', 'launchSettings.json'));
            expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).profiles)).toEqual(['http', 'https']);
        });

        it('leaves an existing file alone', async () => {
            const projectPath = path.join(dir, 'Api.csproj');
            fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
            fs.mkdirSync(path.join(dir, 'Properties'));
            fs.writeFileSync(path.join(dir, 'Properties', 'launchSettings.json'), '// mine\n{}');

            const file = await ensureLaunchSettings(projectPath);

            expect(fs.readFileSync(file, 'utf8')).toBe('// mine\n{}');
        });
    });
});
