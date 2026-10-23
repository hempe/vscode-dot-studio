import * as path from 'path';
import { chooseTestFramework, isNetFramework, isTestProjectCandidate, multiTargetFrameworks, parseRuntimeMajors, parseTestProperties, pickTestFramework, testProjectFrom } from '../../../../services/testing/testProjects';

const project = (items: string, properties = '') =>
    `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework>${properties}</PropertyGroup><ItemGroup>${items}</ItemGroup></Project>`;

describe('test projects', () => {
    it('recognizes test frameworks and test SDKs', () => {
        expect(isTestProjectCandidate(project('<PackageReference Include="xunit.v3" Version="3.2.2" />'))).toBe(true);
        expect(isTestProjectCandidate(project('<PackageReference Include="MSTest" Version="4.0.1" />'))).toBe(true);
        expect(isTestProjectCandidate(project('<PackageReference Include="TUnit" Version="0.1" />'))).toBe(true);
        expect(isTestProjectCandidate(project('<PackageReference Include="NUnit" Version="4.0" />'))).toBe(true);
        expect(isTestProjectCandidate(project('<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17" />'))).toBe(true);
        expect(isTestProjectCandidate('<Project Sdk="MSTest.Sdk/3.6.4"></Project>')).toBe(true);
        expect(isTestProjectCandidate(project('', '<IsTestProject>true</IsTestProject>'))).toBe(true);
    });

    it('leaves other projects out', () => {
        expect(isTestProjectCandidate(project('<PackageReference Include="Newtonsoft.Json" Version="13" />'))).toBe(false);
        expect(isTestProjectCandidate(project('<PackageReference Include="xunit.abstractions" Version="2" />'))).toBe(false);
    });

    it('reads what MSBuild says about the project', () => {
        expect(parseTestProperties('{"Properties":{"IsTestingPlatformApplication":"true","TargetPath":"/r/X3.dll"}}'))
            .toEqual({ testingPlatform: true, targetPath: '/r/X3.dll' });
        expect(parseTestProperties('{"Properties":{"IsTestingPlatformApplication":"","TargetPath":"/r/T.dll"}}'))
            .toEqual({ testingPlatform: false, targetPath: '/r/T.dll' });
        expect(parseTestProperties('{"Properties":{"IsTestingPlatformApplication":"false","TargetPath":"/r/N.dll","VSTestConsolePath":"/sdk/vstest.console.dll"}}'))
            .toEqual({ testingPlatform: false, targetPath: '/r/N.dll', vstestConsolePath: '/sdk/vstest.console.dll' });
        expect(parseTestProperties('error MSB1009')).toEqual({ testingPlatform: false });
    });
});

describe('the framework a multi-targeted test project runs on', () => {
    const pick = (frameworks: string, runtimes: number[]) => pickTestFramework(frameworks.split(';'), runtimes);

    it('takes the highest modern framework an installed runtime supports', () => {
        expect(pick('net8.0;net9.0;net472', [8, 10])).toBe('net8.0');
        expect(pick('net8.0;net9.0;net472', [8, 9, 10])).toBe('net9.0');
        expect(pick('net10.0;net8.0', [8])).toBe('net8.0');
        expect(pick('netstandard2.0;net8.0', [8, 10])).toBe('net8.0');
        expect(pick('netcoreapp3.1;net6.0-windows', [3, 6])).toBe('net6.0-windows');
    });

    it('takes the highest modern framework when no runtime fits, else the first', () => {
        expect(pick('net8.0;net9.0;net472', [])).toBe('net9.0');
        expect(pick('netstandard2.0;net8.0', [10])).toBe('net8.0');
        expect(pick('net472', [8, 10])).toBe('net472');
        expect(pick('net48;net472', [8])).toBe('net48');
        expect(pick('netcoreapp2.1;net461', [8])).toBe('netcoreapp2.1');
    });

    it('reads the installed runtime versions', () => {
        expect(parseRuntimeMajors([
            'Microsoft.AspNetCore.App 10.0.11 [/usr/share/dotnet/shared/Microsoft.AspNetCore.App]',
            'Microsoft.NETCore.App 8.0.30 [/usr/share/dotnet/shared/Microsoft.NETCore.App]',
            'Microsoft.NETCore.App 10.0.11 [/usr/share/dotnet/shared/Microsoft.NETCore.App]',
            'Microsoft.WindowsDesktop.App 9.0.1 [C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App]',
        ].join('\r\n'))).toEqual([8, 10]);
        expect(parseRuntimeMajors('')).toEqual([]);
    });

    it('reads the frameworks of a multi-targeted project from MSBuild', () => {
        expect(multiTargetFrameworks('{"Properties":{"TargetFramework":"","TargetFrameworks":"net8.0; net9.0;net472;"}}')).toEqual(['net8.0', 'net9.0', 'net472']);
        expect(multiTargetFrameworks('{"Properties":{"TargetFramework":"net10.0","TargetFrameworks":""}}')).toEqual([]);
        expect(multiTargetFrameworks('error MSB1009')).toEqual([]);
    });
});

describe('the selected framework (Select Framework) and the test framework', () => {
    const choose = (frameworks: string, selected?: string, runtimes = [8, 10]) => chooseTestFramework(frameworks.split(';'), runtimes, selected)!;

    it('takes the selected framework when the project targets it', () => {
        expect(choose('net8.0;net10.0', 'net8.0')).toEqual({ framework: 'net8.0', reason: 'the selected framework' });
        expect(choose('net8.0;net9.0', 'net9.0').framework).toBe('net9.0');
    });

    it('takes net472 when it is selected, even with modern frameworks next to it', () => {
        expect(choose('net8.0;net472;net10.0', 'net472').framework).toBe('net472');
    });

    it('picks automatically when the selected framework is not one of the project\'s', () => {
        expect(choose('net8.0;net472', 'net10.0')).toEqual({
            framework: 'net8.0',
            reason: 'automatic: the selected framework net10.0 is not one of net8.0, net472; the highest .NET with an installed runtime',
        });
    });

    it('picks automatically when no framework is selected', () => {
        expect(choose('net8.0;net9.0;net472', undefined)).toEqual({ framework: 'net8.0', reason: 'automatic: the highest .NET with an installed runtime' });
        expect(choose('net9.0;net472', undefined, [8]).reason).toBe('automatic: no installed runtime fits, the highest .NET');
        expect(choose('net48;net472', undefined)).toEqual({ framework: 'net48', reason: 'automatic: no modern .NET, the first framework' });
    });

    it('tells .NET Framework frameworks apart', () => {
        expect(['net472', 'net48', 'net481', 'net462', 'net45', 'net40', 'net35'].every(isNetFramework)).toBe(true);
        expect(['net8.0', 'net10.0', 'netcoreapp3.1', 'netstandard2.0', 'net6.0-windows', undefined].some(isNetFramework)).toBe(false);
    });
});

describe('the run settings file of a test project', () => {
    it('reads the run settings file, relative to the project folder when MSBuild gives a relative path', () => {
        const projectPath = path.resolve('repo', 'tests', 'A', 'A.csproj');
        const json = (runSettings: string) => JSON.stringify({ Properties: { IsTestingPlatformApplication: 'false', TargetPath: path.resolve('repo', 'A.dll'), RunSettingsFilePath: runSettings } });
        expect(testProjectFrom(projectPath, json(path.join(path.dirname(projectPath), '..', 'team.runsettings')))?.runSettingsPath)
            .toBe(path.resolve('repo', 'tests', 'team.runsettings'));
        expect(testProjectFrom(projectPath, json('local.runsettings'))?.runSettingsPath).toBe(path.resolve('repo', 'tests', 'A', 'local.runsettings'));
        expect(testProjectFrom(projectPath, json(''))).not.toHaveProperty('runSettingsPath');
        expect(testProjectFrom(projectPath, 'error MSB1009')).toBeUndefined();
    });

    it('keeps the framework choice of a multi-targeted project', () => {
        const json = JSON.stringify({ Properties: { IsTestingPlatformApplication: 'false', TargetPath: '/r/bin/net472/A.dll', VSTestConsolePath: '/sdk/vstest.console.dll' } });
        expect(testProjectFrom('/r/A.csproj', json, 'net472', { framework: 'net472', reason: 'the selected framework' })).toEqual({
            projectPath: '/r/A.csproj', targetPath: '/r/bin/net472/A.dll', testingPlatform: false, vstestConsolePath: '/sdk/vstest.console.dll',
            targetFramework: 'net472', frameworkReason: 'the selected framework', netFramework: true,
        });
    });
});
