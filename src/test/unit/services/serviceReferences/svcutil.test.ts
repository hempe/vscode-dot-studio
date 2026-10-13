import * as os from 'os';
import * as path from 'path';
import { listsSvcutil, svcutilCommand, SVCUTIL_ENV } from '../../../../services/serviceReferences/svcutil';

describe('dotnet-svcutil', () => {
    it('finds it in `dotnet tool list` output', () => {
        const output = `Package Id          Version      Commands          Manifest
--------------------------------------------------------------------------
dotnet-svcutil      8.0.0        dotnet-svcutil    /repo/.config/dotnet-tools.json`;
        expect(listsSvcutil(output)).toBe(true);
        expect(listsSvcutil('Package Id      Version      Commands\n-----------')).toBe(false);
    });

    it('runs local tools through dotnet and global ones from the tools folder', () => {
        expect(svcutilCommand('local', ['--update', 'x'])).toEqual({ file: 'dotnet', args: ['tool', 'run', 'dotnet-svcutil', '--', '--update', 'x'] });
        const global = svcutilCommand('global', ['-h']);
        expect(global.file).toBe(path.join(os.homedir(), '.dotnet', 'tools', process.platform === 'win32' ? 'dotnet-svcutil.exe' : 'dotnet-svcutil'));
        expect(global.args).toEqual(['-h']);
    });

    it('rolls forward to the installed runtime and opts out of telemetry', () => {
        expect(SVCUTIL_ENV).toEqual({ DOTNET_ROLL_FORWARD: 'Major', DOTNET_SVCUTIL_TELEMETRY_OPTOUT: '1' });
    });
});
