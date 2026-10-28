import { isNetFrameworkTarget, parseTargetFrameworks } from '../../../parsers/targetFrameworks';

const project = (properties: string) => `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>${properties}</PropertyGroup></Project>`;

describe('parseTargetFrameworks', () => {
    it('reads one framework', async () => {
        expect(await parseTargetFrameworks(project('<TargetFramework>net48</TargetFramework>'))).toEqual(['net48']);
    });

    it('reads several, trimmed', async () => {
        expect(await parseTargetFrameworks(project('<TargetFrameworks>net48; net10.0;</TargetFrameworks>'))).toEqual(['net48', 'net10.0']);
    });

    it('has none when the project declares none', async () => {
        expect(await parseTargetFrameworks(project('<OutputType>Exe</OutputType>'))).toEqual([]);
    });
});

describe('isNetFrameworkTarget', () => {
    it('tells .NET Framework (net20 ... net481) from the rest', () => {
        expect(['net472', 'net48', 'net481', 'net462', 'net45', 'net40', 'net35', 'NET48'].every(isNetFrameworkTarget)).toBe(true);
        expect(['net8.0', 'net10.0', 'netcoreapp3.1', 'netstandard2.0', 'net6.0-windows', undefined, null, ''].some(isNetFrameworkTarget)).toBe(false);
    });
});
