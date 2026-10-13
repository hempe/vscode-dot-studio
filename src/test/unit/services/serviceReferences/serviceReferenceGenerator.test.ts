import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { explainSvcutilFailure, generateServiceReference, removeServiceReference, Svcutil } from '../../../../services/serviceReferences/serviceReferenceGenerator';
import { newServiceReference, readServiceReference } from '../../../../services/serviceReferences/connectedService';

const fixtureProject = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');

/** Writes Reference.cs like svcutil and, like svcutil, adds 4.10.* packages to the project */
const fakeSvcutil = (calls: string[][], fail = false): Svcutil => async (args, cwd) => {
    calls.push(args);
    const folder = path.join(cwd, args[1]);
    const params = JSON.parse(fs.readFileSync(path.join(folder, 'dotnet-svcutil.params.json'), 'utf8'));
    const csproj = fs.readdirSync(cwd).find(f => f.endsWith('.csproj'))!;
    fs.writeFileSync(path.join(cwd, csproj), fs.readFileSync(path.join(cwd, csproj), 'utf8').replace('</Project>', '<ItemGroup><PackageReference Include="System.ServiceModel.Duplex" Version="4.10.*" /></ItemGroup></Project>'));
    if (fail) {
        return { code: 1, output: 'Error: cannot load metadata' };
    }
    fs.writeFileSync(path.join(folder, params.options.outputFile ?? 'Reference.cs'), `// ${params.options.targetFramework}\nnew System.ServiceModel.BasicHttpBinding();\n`);
    return { code: 0, output: 'Generating files...' };
};

describe('generateServiceReference', () => {
    let project: string;
    let projectPath: string;
    let added: string[];

    beforeEach(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcgen-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        projectPath = path.join(project, 'PayLoop.csproj');
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace('net471', 'net10.0'));
        added = [];
    });
    afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

    const addPackage = async (_project: string, id: string) => { added.push(id); };

    it('updates a Visual Studio reference for the current framework and keeps its metadata format', async () => {
        const calls: string[][] = [];
        const folder = path.join(project, 'Connected Services', 'CardOperations');
        const before = fs.readFileSync(projectPath, 'utf8');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0', svcutil: fakeSvcutil(calls), addPackage,
        });

        expect(result.success).toBe(true);
        expect(calls[0][0]).toBe('--update');
        expect(calls[0][1]).toMatch(/^obj[\\/]shinobi-svcutil-/);
        expect(fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8')).toContain('// net10.0');
        expect(fs.existsSync(path.join(folder, 'dotnet-svcutil.params.json'))).toBe(false);
        const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'ConnectedService.json'), 'utf8'));
        expect(metadata.ProviderId).toBe('Microsoft.VisualStudio.ConnectedService.Wcf');
        expect(metadata.ExtendedData.targetFramework).toBe('net10.0');
        expect(metadata.ExtendedData.inputs).toEqual(['CardOperations.wsdl']);
        // svcutil's package edits are undone; WCFMetadata was already there
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(before);
        expect(added).toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives']);
        expect(fs.readdirSync(path.join(project, 'obj')).filter(f => f.startsWith('shinobi-svcutil-'))).toEqual([]);
    });

    it('adds a new reference from a local WSDL file', async () => {
        const wsdl = path.join(project, 'Connected Services', 'CardOperations', 'CardOperations.wsdl');
        const folder = path.join(project, 'Connected Services', 'Cards');
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace(/\s*<ItemGroup>\s*<WCFMetadata[^>]*>\s*<\/ItemGroup>/, ''));

        const result = await generateServiceReference({
            projectPath, reference: newServiceReference(folder, wsdl, 'Cards', 'net10.0'), targetFramework: 'net10.0', svcutil: fakeSvcutil([]), addPackage,
        });

        expect(result.success).toBe(true);
        expect(fs.readdirSync(folder).sort()).toEqual(['CardOperations.wsdl', 'ConnectedService.json', 'Reference.cs']);
        expect(JSON.parse(fs.readFileSync(path.join(folder, 'ConnectedService.json'), 'utf8')).ExtendedData.inputs).toEqual(['CardOperations.wsdl']);
        expect(fs.readFileSync(projectPath, 'utf8')).toContain('<WCFMetadata Include="Connected Services" />');
    });

    it('a failing run leaves the reference and the project file as they were', async () => {
        const folder = path.join(project, 'Connected Services', 'CardOperations');
        fs.writeFileSync(path.join(folder, 'Reference.cs'), '// old');
        const before = fs.readFileSync(projectPath, 'utf8');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0', svcutil: fakeSvcutil([], true), addPackage,
        });

        expect(result).toEqual({ success: false, output: 'Error: cannot load metadata' });
        expect(fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8')).toBe('// old');
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(before);
        expect(added).toEqual([]);
    });
});

describe('explainSvcutilFailure', () => {
    it('points at .NET Framework assembly references, which svcutil cannot read', () => {
        expect(explainSvcutilFailure("Error: The project reference specification 'System.ServiceModel' does not have a file path."))
            .toContain('<Reference Include="System.ServiceModel" />');
        expect(explainSvcutilFailure('Error: cannot load metadata')).toBe('Error: cannot load metadata');
    });
});

describe('removeServiceReference', () => {
    it('deletes the folder, and Connected Services with WCFMetadata when it was the last one', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcrm-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        const projectPath = path.join(project, 'PayLoop.csproj');

        await removeServiceReference(projectPath, path.join(project, 'Connected Services', 'CardOperations'));

        expect(fs.existsSync(path.join(project, 'Connected Services'))).toBe(false);
        expect(fs.readFileSync(projectPath, 'utf8')).not.toContain('WCFMetadata');
        fs.rmSync(project, { recursive: true });
    });
});
