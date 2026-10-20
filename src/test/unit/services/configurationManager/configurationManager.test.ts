import * as fs from 'fs';
import * as path from 'path';
import { readConfigurationModel, renderConfigurationModel, configurationProjectsOf } from '../../../../services/configurationManager/configurationManager';
import { addPlatform } from '../../../../services/configurationManager/model';
import { SolutionFileParser } from '../../../../parsers/solutionFileParser';
import { SolutionXFileParser } from '../../../../parsers/solutionXFileParser';

const sln = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.sln'), 'utf8');
const slnx = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.slnx'), 'utf8');
const DIR = '/tmp/sample';
const projects = [
    { path: 'src/App/App.csproj', guid: '{11111111-1111-1111-1111-111111111111}' },
    { path: 'src/Lib/Lib.csproj', guid: '{22222222-2222-2222-2222-222222222222}' },
];

it.each([['sln', sln], ['slnx', slnx]])('reads and writes a .%s', (type, content) => {
    const model = readConfigurationModel(type as 'sln' | 'slnx', content, projects);
    expect(model.platforms).toContain('x64');
    const rendered = renderConfigurationModel(type as 'sln' | 'slnx', content, addPlatform(model, 'ARM64'), projects);
    expect(readConfigurationModel(type as 'sln' | 'slnx', rendered, projects).platforms).toContain('ARM64');
});

describe('configurationProjectsOf', () => {
    it('lists the projects of a .sln with forward slashes and their guids', async () => {
        expect(configurationProjectsOf(await SolutionFileParser.parse(sln, DIR))).toEqual(projects);
    });

    it('lists the projects of a .slnx by path', async () => {
        const refs = configurationProjectsOf(await SolutionXFileParser.parse(slnx));
        expect(refs.map(r => r.path)).toEqual(projects.map(p => p.path));
    });

    it('leaves out solution folders', async () => {
        const withFolder = sln.replace(/^Global/m, 'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Items", "Items", "{33333333-3333-3333-3333-333333333333}"\nEndProject\nGlobal');
        expect(withFolder).not.toBe(sln);
        expect(configurationProjectsOf(await SolutionFileParser.parse(withFolder, DIR)).map(r => r.path)).toEqual(projects.map(p => p.path));
        const slnxFolder = slnx.replace('  <Project Path="src/App', '  <Folder Name="/Items/" />\n  <Project Path="src/App');
        expect(configurationProjectsOf(await SolutionXFileParser.parse(slnxFolder)).map(r => r.path)).toEqual(projects.map(p => p.path));
    });
});
