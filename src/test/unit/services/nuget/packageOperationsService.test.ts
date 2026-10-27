jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] }, window: {}, commands: {}, env: {} }), { virtual: true });
jest.mock('../../../../services/nuget/dotnetCli', () => ({ execDotnet: jest.fn() }));
jest.mock('../../../../services/nuget/feedAuth', () => ({ reportRejectedInOutput: jest.fn() }));

import { execDotnet } from '../../../../services/nuget/dotnetCli';
import { reportRejectedInOutput } from '../../../../services/nuget/feedAuth';
import { PackageOperationsService } from '../../../../services/nuget/packageOperationsService';

const run = execDotnet as jest.Mock;
const ok = (stdout = '', stderr = '') => run.mockResolvedValueOnce({ stdout, stderr });
const fail = (message: string, extra: Record<string, string> = {}) => run.mockRejectedValueOnce(Object.assign(new Error(message), extra));

beforeEach(() => { run.mockReset(); (reportRejectedInOutput as jest.Mock).mockReset(); });

describe('PackageOperationsService', () => {
    describe('installPackage', () => {
        it('runs dotnet add package with the version, source, prerelease and no-restore options', async () => {
            ok('info : PackageReference for package added');
            const result = await PackageOperationsService.installPackage({ projectPath: '/w/App.csproj', packageId: 'Serilog', version: '4.0.0', source: 'birs', prerelease: true, noRestore: true });

            expect(run.mock.calls[0][0]).toEqual(['add', '/w/App.csproj', 'package', 'Serilog', '--version', '4.0.0', '--source', 'birs', '--prerelease', '--no-restore']);
            expect(result).toMatchObject({ success: true, packageId: 'Serilog', version: '4.0.0', projectPath: '/w/App.csproj', message: 'Successfully installed Serilog version 4.0.0' });
        });

        it('is a success when the output only mentions "error" (a folder named error-pages)', async () => {
            ok('Restored /w/error-pages/App.csproj');
            expect((await PackageOperationsService.installPackage({ projectPath: '/w/App.csproj', packageId: 'X' })).success).toBe(true);
        });

        it('reports a failing command with its message, and lets the feed-auth hint see the output', async () => {
            fail('Command failed: dotnet add', { stdout: 'x', stderr: 'error NU1301: Unable to load the service index' });
            const result = await PackageOperationsService.installPackage({ projectPath: '/w/App.csproj', packageId: 'X' });

            expect(result).toMatchObject({ success: false, packageId: 'X', projectPath: '/w/App.csproj' });
            expect(result.message).toContain('Command failed');
            expect((reportRejectedInOutput as jest.Mock).mock.calls[0][0]).toContain('NU1301');
        });
    });

    describe('uninstallPackage', () => {
        it('runs dotnet remove package', async () => {
            ok();
            expect(await PackageOperationsService.uninstallPackage('/w/App.csproj', 'Serilog')).toMatchObject({ success: true, message: 'Successfully uninstalled Serilog' });
            expect(run.mock.calls[0][0]).toEqual(['remove', '/w/App.csproj', 'package', 'Serilog']);
        });

        it('reports a failure', async () => {
            fail('boom');
            expect(await PackageOperationsService.uninstallPackage('/w/App.csproj', 'Serilog')).toMatchObject({ success: false, message: 'Error uninstalling Serilog: boom' });
        });
    });

    describe('restorePackages', () => {
        it('succeeds when the command does, whatever the output says', async () => {
            ok('error-pages\nRestore succeeded in 1s');
            expect(await PackageOperationsService.restorePackages('/w/App.sln')).toMatchObject({ success: true, message: 'Successfully restored packages for App.sln' });
            expect(run.mock.calls[0][0]).toEqual(['restore', '/w/App.sln']);
        });

        it('reports a command that fails, with its message', async () => {
            fail('error NU1101: Unable to find package');
            expect(await PackageOperationsService.restorePackages('/w/App.sln')).toMatchObject({ success: false, message: 'Error restoring packages: error NU1101: Unable to find package' });
        });
    });
});
