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
        it('succeeds on "Restore succeeded", also when other lines say error', async () => {
            ok('error-pages\nRestore succeeded in 1s');
            expect(await PackageOperationsService.restorePackages('/w/App.sln')).toMatchObject({ success: true, message: 'Successfully restored packages for App.sln' });
            expect(run.mock.calls[0][0]).toEqual(['restore', '/w/App.sln']);
        });

        it('fails when the output reports an error and not a success', async () => {
            ok('', 'error NU1101: Unable to find package');
            const result = await PackageOperationsService.restorePackages('/w/App.sln');
            expect(result.success).toBe(false);
            expect(result.message).toContain('NU1101');
        });

        it('reports a command that throws', async () => {
            fail('timed out');
            expect(await PackageOperationsService.restorePackages('/w/App.sln')).toMatchObject({ success: false, message: 'Error restoring packages: timed out' });
        });
    });

    describe('addPackageReference', () => {
        it('adds the version and framework when given', async () => {
            ok();
            const result = await PackageOperationsService.addPackageReference('/w/App.csproj', 'Serilog', '4.0.0', 'net8.0');
            expect(run.mock.calls[0][0]).toEqual(['add', '/w/App.csproj', 'package', 'Serilog', '--version', '4.0.0', '--framework', 'net8.0']);
            expect(result).toMatchObject({ success: true, version: '4.0.0' });
        });

        it('reports a failure', async () => {
            fail('nope');
            expect(await PackageOperationsService.addPackageReference('/w/App.csproj', 'Serilog')).toMatchObject({ success: false, message: 'Error adding package reference: nope' });
        });
    });

    describe('clearCache', () => {
        it('clears all NuGet caches', async () => {
            ok('Clearing NuGet HTTP cache');
            expect((await PackageOperationsService.clearCache()).success).toBe(true);
            expect(run.mock.calls[0][0]).toEqual(['nuget', 'locals', 'all', '--clear']);
        });

        it('fails on an error without a "Clearing" line, and when the command throws', async () => {
            ok('', 'error: access denied');
            expect((await PackageOperationsService.clearCache()).success).toBe(false);
            fail('x');
            expect((await PackageOperationsService.clearCache()).message).toBe('Error clearing package cache: x');
        });
    });

    describe('verifyPackageInstalled and getPackageStatus', () => {
        it('finds the package in the list, and says no when listing fails', async () => {
            ok('> Serilog 4.0.0');
            expect(await PackageOperationsService.verifyPackageInstalled('/w/App.csproj', 'Serilog')).toBe(true);
            ok('> Other 1.0.0');
            expect(await PackageOperationsService.verifyPackageInstalled('/w/App.csproj', 'Serilog')).toBe(false);
            fail('x');
            expect(await PackageOperationsService.verifyPackageInstalled('/w/App.csproj', 'Serilog')).toBe(false);
        });

        it('reads the version and whether the package is transitive', async () => {
            ok(JSON.stringify({ projects: [{ path: '/w/App.csproj', frameworks: [{ framework: 'net8.0',
                topLevelPackages: [{ id: 'Serilog', resolvedVersion: '4.0.0' }],
                transitivePackages: [{ id: 'Newtonsoft.Json', resolvedVersion: '13.0.3' }] }] }] }));
            expect(await PackageOperationsService.getPackageStatus('/w/App.csproj', 'Serilog')).toMatchObject({ installed: true, version: '4.0.0' });
            ok(JSON.stringify({ projects: [{ path: '/w/App.csproj', frameworks: [{ framework: 'net8.0', transitivePackages: [{ id: 'Newtonsoft.Json', resolvedVersion: '13.0.3' }] }] }] }));
            expect(await PackageOperationsService.getPackageStatus('/w/App.csproj', 'Newtonsoft.Json')).toMatchObject({ installed: true, isTransitive: true });
            ok('not json');
            expect(await PackageOperationsService.getPackageStatus('/w/App.csproj', 'X')).toMatchObject({ installed: false });
        });
    });
});
