import { isTestProjectCandidate, parseTestProperties } from '../../../../services/testing/testProjects';

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
        expect(parseTestProperties('error MSB1009')).toEqual({ testingPlatform: false });
    });
});
