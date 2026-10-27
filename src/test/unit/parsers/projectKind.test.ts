import { isExecutableProject, isWebProject, usesEntityFramework } from '../../../parsers/projectKind';

const project = (sdk: string, body = '') =>
    `<Project Sdk="${sdk}"><PropertyGroup><TargetFramework>net10.0</TargetFramework>${body}</PropertyGroup></Project>`;

describe('isExecutableProject', () => {
    it('class libraries are not executable', () => {
        expect(isExecutableProject(project('Microsoft.NET.Sdk'))).toBe(false);
        expect(isExecutableProject(project('Microsoft.NET.Sdk', '<OutputType>Library</OutputType>'))).toBe(false);
        expect(isExecutableProject(project('Microsoft.NET.Sdk.Razor'))).toBe(false);
    });

    it('console and desktop apps are executable', () => {
        expect(isExecutableProject(project('Microsoft.NET.Sdk', '<OutputType>Exe</OutputType>'))).toBe(true);
        expect(isExecutableProject(project('Microsoft.NET.Sdk', '<OutputType>winexe</OutputType>'))).toBe(true);
    });

    it('web, worker and Aspire host SDKs are executable without an OutputType', () => {
        expect(isExecutableProject(project('Microsoft.NET.Sdk.Web'))).toBe(true);
        expect(isExecutableProject(project('Microsoft.NET.Sdk.Worker'))).toBe(true);
        expect(isExecutableProject(project('Aspire.AppHost.Sdk/9.0.0'))).toBe(true);
        expect(isExecutableProject('<Project><Sdk Name="Microsoft.NET.Sdk.Web" /><PropertyGroup /></Project>')).toBe(true);
    });

    it('an explicit Library OutputType wins over the SDK', () => {
        expect(isExecutableProject(project('Microsoft.NET.Sdk.Web', '<OutputType>Library</OutputType>'))).toBe(false);
    });

    it('test projects are not executable, even when the test SDK makes them an Exe', () => {
        expect(isExecutableProject(project('Microsoft.NET.Sdk', '<IsTestProject>true</IsTestProject><OutputType>Exe</OutputType>'))).toBe(false);
        expect(isExecutableProject(
            '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" /></ItemGroup></Project>'
        )).toBe(false);
        expect(isExecutableProject(project('MSTest.Sdk/3.6.4', '<OutputType>Exe</OutputType>'))).toBe(false);
    });
});

describe('isWebProject', () => {
    it('is true for the web SDK only', () => {
        expect(isWebProject(project('Microsoft.NET.Sdk.Web'))).toBe(true);
        expect(isWebProject('<Project><Sdk Name="Microsoft.NET.Sdk.Web/10.0.100" /></Project>')).toBe(true);
        expect(isWebProject(project('Microsoft.NET.Sdk.Worker'))).toBe(false);
        expect(isWebProject(project('Microsoft.NET.Sdk', '<OutputType>Exe</OutputType>'))).toBe(false);
    });
});

describe('usesEntityFramework', () => {
    it('recognizes Entity Framework Core packages of any provider, also from a props file', () => {
        expect(usesEntityFramework('<Project><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" Version="9.0.0" /></ItemGroup></Project>')).toBe(true);
        expect(usesEntityFramework('<PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" />')).toBe(true);
        expect(usesEntityFramework("<PackageReference Update='microsoft.entityframeworkcore.design' />")).toBe(true);
    });

    it('is false for other packages, look-alikes and projects that only mention it', () => {
        expect(usesEntityFramework('<PackageReference Include="EntityFramework" Version="6.4.4" />')).toBe(false);
        expect(usesEntityFramework('<PackageReference Include="Microsoft.EntityFrameworkCoreX" />')).toBe(false);
        expect(usesEntityFramework('<!-- Microsoft.EntityFrameworkCore -->')).toBe(false);
    });
});
