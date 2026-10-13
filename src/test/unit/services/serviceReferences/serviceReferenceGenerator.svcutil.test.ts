// Runs the real dotnet-svcutil on the CardOperations WSDL; skipped when it isn't installed
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateServiceReference } from '../../../../services/serviceReferences/serviceReferenceGenerator';
import { readServiceReference } from '../../../../services/serviceReferences/connectedService';
import { findSvcutil, runSvcutil } from '../../../../services/serviceReferences/svcutil';

const fixtureProject = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;

describe('dotnet-svcutil integration', () => {
    jest.setTimeout(120000);

    it('regenerates the PayLoop reference for net10.0 like Visual Studio would', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcint-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        const install = hasDotnet ? await findSvcutil(project) : undefined;
        if (!install) {
            console.warn('dotnet-svcutil not installed, skipping');
            return;
        }
        const projectPath = path.join(project, 'PayLoop.csproj');
        // Ported like the real project: modern framework, the GAC System.ServiceModel reference gone
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8')
            .replace('net471', 'net10.0')
            .replace(/\s*<ItemGroup>\s*<Reference Include="System.ServiceModel" \/>\s*<\/ItemGroup>/, ''));
        const folder = path.join(project, 'Connected Services', 'CardOperations');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0',
            svcutil: (args, cwd) => runSvcutil(install, args, cwd), addPackage: async () => { },
        });

        if (!result.success) {
            throw new Error(`svcutil failed:\n${result.output}`);
        }
        const code = fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8');
        expect(code).toContain('namespace CardOperations');
        expect(code).toContain('public partial class CardOperationsSoapClient');
        expect(code).toContain('[System.ServiceModel.MessageContractAttribute(IsWrapped=false)]');
        expect(code).toContain('CardOperationsSoap12,');
        expect(fs.readFileSync(projectPath, 'utf8')).not.toContain('4.10');
        fs.rmSync(project, { recursive: true });
    });
});
