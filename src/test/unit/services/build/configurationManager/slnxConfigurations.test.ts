import * as fs from 'fs';
import * as path from 'path';
import { readSlnxModel, renderSlnxModel } from '../../../../services/configurationManager/slnxConfigurations';
import { resolveMapping, setMapping, addPlatform, renameConfiguration, removePlatform } from '../../../../services/configurationManager/model';

const content = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.slnx'), 'utf8');
const projects = [{ path: 'src/App/App.csproj', guid: 'a' }, { path: 'src/Lib/Lib.csproj', guid: 'b' }];
const APP = 'src/App/App.csproj';
const LIB = 'src/Lib/Lib.csproj';

const solution = (body: string, configurations = '<Configurations><BuildType Name="Debug" /><BuildType Name="Release" /><Platform Name="Any CPU" /><Platform Name="x64" /></Configurations>') =>
    `<Solution>\n  ${configurations}\n${body}\n</Solution>\n`;

describe('readSlnxModel', () => {
    it('reads the lists', () => {
        const model = readSlnxModel(content, projects);
        expect(model.configurations).toEqual(['Debug', 'Release']);
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
    });

    it('expands wildcards and lets the exact pair win', () => {
        const model = readSlnxModel(content, projects);
        expect(resolveMapping(model, LIB, 'Release', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: true });
        expect(resolveMapping(model, LIB, 'Debug', 'x64')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: false });
        expect(resolveMapping(model, APP, 'Debug', 'x64')).toEqual({ configuration: 'Debug', platform: 'x64', build: true });
    });

    it('understands every spelling of the Solution attribute', () => {
        const model = readSlnxModel(solution(`  <Project Path="${APP}">
    <BuildType Solution="Debug|*" Project="B1" />
    <Platform Solution="*|x64" Project="P1" />
    <Platform Solution="Release|x64" Project="P2" />
    <BuildType Solution="Release" Project="B2" />
    <Build Solution="*|*" Project="false" />
    <Build Solution="Debug|Any CPU" Project="true" />
  </Project>`), projects);
        expect(resolveMapping(model, APP, 'Debug', 'Any CPU')).toEqual({ configuration: 'B1', platform: 'Any CPU', build: true });
        expect(resolveMapping(model, APP, 'Debug', 'x64')).toEqual({ configuration: 'B1', platform: 'P1', build: false });
        expect(resolveMapping(model, APP, 'Release', 'x64')).toEqual({ configuration: 'B2', platform: 'P2', build: false });
        expect(resolveMapping(model, APP, 'Release', 'Any CPU')).toEqual({ configuration: 'B2', platform: 'Any CPU', build: false });
    });

    it('lets a more specific rule beat a less specific one wherever it sits', () => {
        const model = readSlnxModel(solution(`  <Project Path="${APP}">
    <Platform Solution="Debug|x64" Project="exact" />
    <Platform Solution="Debug|*" Project="half" />
    <Platform Solution="*|*" Project="all" />
  </Project>`), projects);
        expect(resolveMapping(model, APP, 'Debug', 'x64').platform).toBe('exact');
        expect(resolveMapping(model, APP, 'Debug', 'Any CPU').platform).toBe('half');
        expect(resolveMapping(model, APP, 'Release', 'x64').platform).toBe('all');
    });

    it('finds projects inside a Folder and written with a closing tag', () => {
        const model = readSlnxModel(solution(`  <Folder Name="/src/">
    <Project Path="${APP}">
      <Build Solution="Debug|*" Project="false" />
    </Project>
    <Project Path="${LIB}"></Project>
  </Folder>`), projects);
        expect(resolveMapping(model, APP, 'Debug', 'x64').build).toBe(false);
        expect(model.mappings[LIB]).toBeUndefined();
    });

    it('matches a path spelled with backslashes and keys it by the reference', () => {
        const model = readSlnxModel(solution(`  <Project Path="src\\App\\App.csproj">
    <Build Solution="Debug|*" Project="false" />
  </Project>`), projects);
        expect(resolveMapping(model, APP, 'Debug', 'x64').build).toBe(false);
    });

    it('gives the default platform when the file lists none, and the defaults when it has no Configurations', () => {
        expect(readSlnxModel(solution('', '<Configurations><BuildType Name="Debug" /></Configurations>'), projects))
            .toMatchObject({ configurations: ['Debug'], platforms: ['Any CPU'] });
        expect(readSlnxModel('<Solution>\n  <Project Path="a.csproj" />\n</Solution>', projects))
            .toMatchObject({ configurations: ['Debug', 'Release'], platforms: ['Any CPU'] });
    });

    it('throws on malformed xml instead of returning nothing', () => {
        expect(() => readSlnxModel('<Solution><Configurations></Solution>', projects)).toThrow();
    });
});

describe('renderSlnxModel', () => {
    it('round trips: reading what was rendered gives the same model, and rendering again changes nothing', () => {
        const model = readSlnxModel(content, projects);
        const once = renderSlnxModel(content, model, projects);
        expect(readSlnxModel(once, projects)).toEqual(model);
        expect(renderSlnxModel(once, model, projects)).toBe(once);
        expect(once).toContain('<Build Solution="Debug|x64" Project="false" />');
    });

    it('adds a platform to the Configurations element', () => {
        const rendered = renderSlnxModel(content, addPlatform(readSlnxModel(content, projects), 'ARM64'), projects);
        expect(rendered).toContain('<Platform Name="ARM64" />');
    });

    it('writes only the deviations from the default, in the project element', () => {
        const model = setMapping(readSlnxModel(content, projects), APP, 'Debug', 'Any CPU', { configuration: 'Release', platform: 'Any CPU', build: true });
        const rendered = renderSlnxModel(content, model, projects);
        expect(rendered).toContain(`<Project Path="${APP}">`);
        expect(rendered).toContain('<BuildType Solution="Debug|Any CPU" Project="Release" />');
        expect(rendered).not.toContain('<Platform Solution="Debug|Any CPU"');
    });

    it('turns a project with only default mappings back into a self-closing element', () => {
        const model = setMapping(readSlnxModel(content, projects), APP, 'Debug', 'Any CPU', { configuration: 'Release', platform: 'Any CPU', build: true });
        const opened = renderSlnxModel(content, model, projects);
        const reset = setMapping(model, APP, 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'Any CPU', build: true });
        expect(renderSlnxModel(opened, reset, projects)).toContain(`<Project Path="${APP}" />`);
        expect(renderSlnxModel(content, reset, projects)).toContain(`<Project Path="${APP}" />`);
    });

    it('follows a renamed configuration and a removed platform', () => {
        let model = renameConfiguration(readSlnxModel(content, projects), 'Release', 'Prod', [APP, LIB]);
        model = removePlatform(model, 'x64');
        const rendered = renderSlnxModel(content, model, projects);
        expect(rendered).toContain('<BuildType Name="Prod" />');
        expect(rendered).not.toContain('x64');
    });

    it('opens a self-closing project that gets a mapping, also inside a Folder and with a backslash path', () => {
        const source = solution(`  <Folder Name="/src/">
    <Project Path="src\\App\\App.csproj" />
  </Folder>`);
        const model = setMapping(readSlnxModel(source, projects), APP, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: false });
        const rendered = renderSlnxModel(source, model, projects);
        expect(rendered).toContain(`    <Project Path="src\\App\\App.csproj">
      <Build Solution="Debug|x64" Project="false" />
    </Project>`);
        expect(readSlnxModel(rendered, projects)).toEqual(model);
    });

    it('opens a project written with a closing tag but no children, and closes it again', () => {
        const source = solution(`  <Project Path="${APP}"></Project>`);
        const model = setMapping(readSlnxModel(source, projects), APP, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: false });
        const rendered = renderSlnxModel(source, model, projects);
        expect(readSlnxModel(rendered, projects)).toEqual(model);
        expect(rendered).toContain('<Build Solution="Debug|x64" Project="false" />');
        expect(renderSlnxModel(rendered, readSlnxModel(source, projects), projects)).toContain(`<Project Path="${APP}" />`);
    });

    it('keeps other children of a project', () => {
        const source = solution(`  <Project Path="${APP}">
    <Build Solution="Debug|x64" Project="false" />
    <Deploy Solution="Debug|*" />
  </Project>`);
        const rendered = renderSlnxModel(source, setMapping(readSlnxModel(source, projects), APP, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: true }), projects);
        expect(rendered).toContain('<Deploy Solution="Debug|*" />');
        expect(rendered).not.toContain('<Build Solution');
        expect(rendered).toContain(`<Project Path="${APP}">`);
    });

    it('leaves comments, other attributes, folders and unknown elements alone', () => {
        const source = `<Solution>
  <!-- keep me -->
  <Configurations>
    <BuildType Name="Debug" />
    <Platform Name="x64" />
  </Configurations>
  <Folder Name="/Solution Items/">
    <File Path="README.md" />
  </Folder>
  <Properties Name="Custom" Scope="PreLoad" />
  <!-- <Project Path="${APP}" /> -->
  <Project Path="${APP}" Id="11111111-1111-1111-1111-111111111111" Type="x" />
</Solution>
`;
        const model = setMapping(readSlnxModel(source, projects), APP, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: false });
        const rendered = renderSlnxModel(source, model, projects);
        expect(rendered).toContain('  <!-- keep me -->\n');
        expect(rendered).toContain('  <Folder Name="/Solution Items/">\n    <File Path="README.md" />\n  </Folder>\n  <Properties Name="Custom" Scope="PreLoad" />\n');
        expect(rendered).toContain(`  <!-- <Project Path="${APP}" /> -->\n`);
        expect(rendered).toContain(`<Project Path="${APP}" Id="11111111-1111-1111-1111-111111111111" Type="x">`);
    });

    it('inserts a missing Configurations element right after the opening Solution tag', () => {
        const source = '<Solution>\n  <Project Path="src/App/App.csproj" />\n</Solution>\n';
        const rendered = renderSlnxModel(source, readSlnxModel(source, projects), projects);
        expect(rendered.startsWith('<Solution>\n  <Configurations>\n    <BuildType Name="Debug" />')).toBe(true);
        expect(rendered).toContain('</Configurations>\n  <Project Path="src/App/App.csproj" />');
    });

    it('keeps CRLF line endings', () => {
        const source = content.replace(/\r?\n/g, '\r\n');
        const model = setMapping(readSlnxModel(source, projects), APP, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: false });
        const rendered = renderSlnxModel(source, model, projects);
        expect(rendered.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    });
});
