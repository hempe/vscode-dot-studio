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
