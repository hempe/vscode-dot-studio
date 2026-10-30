jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });

import { vscodeHost } from '../../../../services/nuget/centralPackageOperations';
import { PackageOperationsService } from '../../../../services/nuget/packageOperationsService';

describe('vscodeHost.install', () => {
    afterEach(() => jest.restoreAllMocks());

    it('adds the package without a restore: the operations restore once for all the projects they changed', async () => {
        const install = jest.spyOn(PackageOperationsService, 'installPackage').mockResolvedValue({ success: true, message: 'ok' });
        await vscodeHost.install('/repo/App/App.csproj', 'Serilog', '4.0.0');
        expect(install).toHaveBeenCalledWith({ packageId: 'Serilog', version: '4.0.0', projectPath: '/repo/App/App.csproj', noRestore: true });
    });
});

describe('cliFailureReason', () => {
    const { cliFailureReason } = jest.requireActual('../../../../services/nuget/packageOperationsService') as typeof import('../../../../services/nuget/packageOperationsService');

    it('gives the error line of the output: the CLI prints it to stdout, the exception only says "Command failed"', () => {
        const error = Object.assign(new Error('Command failed: dotnet add X.csproj package Cirrus.RuleSet --no-restore\n'), {
            stdout: "info : Adding PackageReference for package 'Cirrus.RuleSet' into project 'X.csproj'.\nwarn : --no-restore flag was used.\nerror: Error while performing Update for package 'Cirrus.RuleSet'. Cannot edit items in imported files - \n",
            stderr: '',
        });
        expect(cliFailureReason(error)).toBe("Error while performing Update for package 'Cirrus.RuleSet'. Cannot edit items in imported files");
    });

    it('keeps the code of an MSBuild style error, and falls back to the first line of the message', () => {
        expect(cliFailureReason({ stdout: 'error NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org', message: 'x' }))
            .toBe('NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org');
        expect(cliFailureReason(new Error('spawn dotnet ENOENT\nmore'))).toBe('spawn dotnet ENOENT');
        expect(cliFailureReason(undefined)).toBe('Unknown error');
    });
});
