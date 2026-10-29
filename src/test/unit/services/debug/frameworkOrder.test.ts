import { sortFrameworksByVersion } from '../../../../services/debug/frameworkOrder';

describe('sortFrameworksByVersion', () => {
    it('puts modern .NET first, newest first, then .NET Core, .NET Framework and .NET Standard', () => {
        expect(sortFrameworksByVersion(['netstandard2.0', 'net48', 'net8.0', 'netcoreapp3.1', 'net10.0', 'net472', 'net9.0', 'netstandard2.1']))
            .toEqual(['net10.0', 'net9.0', 'net8.0', 'netcoreapp3.1', 'net48', 'net472', 'netstandard2.1', 'netstandard2.0']);
    });

    it('ranks a platform suffix with its framework and puts unknown names last', () => {
        expect(sortFrameworksByVersion(['xamarinios', 'net6.0-windows', 'net8.0'])).toEqual(['net8.0', 'net6.0-windows', 'xamarinios']);
    });
});
