import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectFileEditor } from '../../../../parsers/projectFileEditor';
import { addProtobufReference, ensureDevelopmentDependency, grpcPackages, protobufReferenceFor, removeProtobufReference } from '../../../../services/grpc/protobufReferences';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The edits as real MSBuild and Grpc.Tools see them, on a copy of src/__fixtures__/grpc */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;
const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
// Pinned, so the test does not depend on what is newest; restored from nuget.org (or the NuGet cache)
const VERSIONS: Record<string, string> = { 'Google.Protobuf': '3.30.2', 'Grpc.Net.ClientFactory': '2.71.0', 'Grpc.Tools': '2.71.0' };

describe('gRPC references with real MSBuild', () => {
    let root: string;
    let projectPath: string;
    const protoPath = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-refs-')));
        fs.cpSync(fixture, root, { recursive: true });
        projectPath = path.join(root, 'Client', 'Client.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const addReference = () => {
        const reference = protobufReferenceFor(path.dirname(projectPath), protoPath(), 'Client');
        fs.writeFileSync(projectPath, addProtobufReference(fs.readFileSync(projectPath, 'utf8'), reference));
    };

    withDotnet('after the edit the project evaluates the linked Protobuf item; after Remove it is gone', async () => {
        addReference();
        const items = await new ProjectItemsService().evaluate(projectPath);
        expect(items?.protobuf).toEqual([expect.objectContaining({ fullPath: protoPath(), grpcServices: 'Client' })]);
        expect(items?.protobuf[0].link?.replace(/[\\/]/g, '/')).toBe('Protos/greet.proto');
        expect(items?.linkedFilesIn(path.join(root, 'Client', 'Protos')).map(item => item.fullPath)).toEqual([protoPath()]);

        fs.writeFileSync(projectPath, removeProtobufReference(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath), protoPath()));
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(fs.readFileSync(path.join(fixture, 'Client', 'Client.csproj'), 'utf8'));
        expect((await new ProjectItemsService().evaluate(projectPath))?.protobuf).toEqual([]);
    }, TIMEOUT);

    withDotnet('a client project with the packages builds, and Grpc.Tools generates the client class', () => {
        addReference();
        const packages = grpcPackages('Client', false, []);
        let content = ProjectFileEditor.appendItemGroup(fs.readFileSync(projectPath, 'utf8'),
            indent => packages.map(id => `${indent}<PackageReference Include="${id}" Version="${VERSIONS[id]}" />`));
        content = ensureDevelopmentDependency(content, 'Grpc.Tools');
        fs.writeFileSync(projectPath, content);
        fs.writeFileSync(path.join(root, 'Client', 'Program.cs'),
            'var client = new GrpcGreeter.Greeter.GreeterClient(Grpc.Net.Client.GrpcChannel.ForAddress("http://localhost:5000"));\n'
            + 'Console.WriteLine(client.GetType().Name);\n');

        const restore = spawnSync('dotnet', ['restore', projectPath], { encoding: 'utf8' });
        if (restore.status !== 0 && /NU1301|Unable to load the service index/.test(restore.stdout + restore.stderr)) {
            console.warn('Skipped: nuget.org is not reachable and the packages are not in the NuGet cache');
            return;
        }
        expect(restore.status).toBe(0);
        const build = spawnSync('dotnet', ['build', projectPath, '--no-restore', '-nologo'], { encoding: 'utf8' });
        expect(build.stdout).toContain('Build succeeded');
        const generated = fs.readdirSync(path.join(root, 'Client', 'obj'), { recursive: true }).map(String);
        expect(generated.some(file => /GreetGrpc\.cs$/.test(file))).toBe(true);
    }, TIMEOUT);
});
