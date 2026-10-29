import * as fs from 'fs';
import * as path from 'path';
import { readSlnModel, renderSlnModel } from '../../../../../services/build/configurationManager/slnConfigurations';
import { resolveMapping, addPlatform, setMapping, removeConfiguration } from '../../../../../services/build/configurationManager/model';

const content = fs.readFileSync(path.join(__dirname, '../../../../../__fixtures__/configurations/Sample.sln'), 'utf8');
const projects = [
    { path: 'src/App/App.csproj', guid: '{11111111-1111-1111-1111-111111111111}' },
    { path: 'src/Lib/Lib.csproj', guid: '{22222222-2222-2222-2222-222222222222}' },
];

describe('readSlnModel', () => {
    it('reads the lists', () => {
        const model = readSlnModel(content, projects);
        expect(model.configurations).toEqual(['Debug', 'Release']);
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
    });

    it('reads the mappings, Build off when there is no Build.0 line', () => {
        const model = readSlnModel(content, projects);
        expect(resolveMapping(model, 'src/Lib/Lib.csproj', 'Release', 'x64')).toEqual({ configuration: 'Release', platform: 'Any CPU', build: false });
        expect(resolveMapping(model, 'src/App/App.csproj', 'Release', 'x64')).toEqual({ configuration: 'Release', platform: 'Any CPU', build: true });
    });
});

describe('renderSlnModel', () => {
    it('round-trips an unchanged model to the same text', () => {
        const model = readSlnModel(content, projects);
        expect(renderSlnModel(content, model, projects)).toBe(content);
    });

    it('keeps the other sections and the line endings', () => {
        const model = addPlatform(readSlnModel(content, projects), 'ARM64');
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).toContain('GlobalSection(SolutionProperties)');
        expect(rendered).toContain('Debug|ARM64 = Debug|ARM64\r\n');
        expect(rendered.split('\r\n').length).toBeGreaterThan(content.split('\r\n').length);
        expect(rendered).not.toMatch(/[^\r]\n/);
    });

    it('writes an explicit mapping and a missing Build.0', () => {
        let model = readSlnModel(content, projects);
        model = setMapping(model, 'src/App/App.csproj', 'Debug', 'x64', { configuration: 'Release', platform: 'x64', build: false });
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).toContain('{11111111-1111-1111-1111-111111111111}.Debug|x64.ActiveCfg = Release|x64');
        expect(rendered).not.toContain('{11111111-1111-1111-1111-111111111111}.Debug|x64.Build.0');
    });

    it('drops the lines of a removed configuration', () => {
        const model = removeConfiguration(readSlnModel(content, projects), 'Release');
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).not.toContain('Release|');
    });
});

describe('sln edge cases', () => {
    const solutionFolder = '{33333333-3333-3333-3333-333333333333}';

    it('keeps the lines of projects it was not given, unless their pair is gone', () => {
        const extra = `\t\t${solutionFolder}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\r\n\t\t${solutionFolder}.Release|x64.ActiveCfg = Release|x64\r\n\tEndGlobalSection\r\n\tGlobalSection(SolutionProperties)`;
        const withExtra = content.replace('\tEndGlobalSection\r\n\tGlobalSection(SolutionProperties)', extra);
        expect(renderSlnModel(withExtra, readSlnModel(withExtra, projects), projects)).toBe(withExtra);
        const rendered = renderSlnModel(withExtra, removeConfiguration(readSlnModel(withExtra, projects), 'Release'), projects);
        expect(rendered).toContain(`${solutionFolder}.Debug|Any CPU.ActiveCfg`);
        expect(rendered).not.toContain(`${solutionFolder}.Release`);
    });

    it('reads Build off for a missing pair only when the project section exists', () => {
        const noPairs = content.replace(/\t\t\{2222[^\n]*Release\|x64\.ActiveCfg[^\n]*\n/, '');
        expect(resolveMapping(readSlnModel(noPairs, projects), 'src/Lib/Lib.csproj', 'Release', 'x64').build).toBe(false);
        const noSection = content.replace(/\tGlobalSection\(ProjectConfigurationPlatforms\)[\s\S]*?EndGlobalSection\r\n/, '');
        expect(resolveMapping(readSlnModel(noSection, projects), 'src/Lib/Lib.csproj', 'Release', 'x64').build).toBe(true);
    });

    it('matches GUIDs case-insensitively', () => {
        const text = content.replace(/\{22222222-2222/g, '{22222222-aaaa');
        const model = readSlnModel(text, [{ path: 'x', guid: '{22222222-AAAA-2222-2222-222222222222}' }]);
        expect(resolveMapping(model, 'x', 'Release', 'x64').build).toBe(false);
    });

    it('inserts both sections before EndGlobal when there are none', () => {
        const bare = 'Microsoft Visual Studio Solution File, Format Version 12.00\nGlobal\nEndGlobal\n';
        const model = readSlnModel(bare, projects);
        expect(model.configurations).toEqual(['Debug', 'Release']);
        const rendered = renderSlnModel(bare, model, projects);
        expect(rendered).toMatch(/Global\n\tGlobalSection\(SolutionConfigurationPlatforms\) = preSolution\n\t\tDebug\|Any CPU = Debug\|Any CPU\n/);
        expect(rendered).toMatch(/EndGlobalSection\n\tGlobalSection\(ProjectConfigurationPlatforms\) = postSolution\n/);
        expect(rendered).toMatch(/EndGlobalSection\nEndGlobal\n$/);
        expect(rendered).not.toContain('\r');
        expect(readSlnModel(rendered, projects)).toEqual(model);
    });
});
