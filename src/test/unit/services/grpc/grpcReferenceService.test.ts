jest.mock('vscode', () => ({
    window: { createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addGrpcReference, GrpcHost, installGrpcPackages } from '../../../../services/grpc/grpcReferenceService';
import { OperationsHost } from '../../../../services/nuget/centralPackageOperations';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
const GREET_URL = 'https://example.com/protos/greet.proto';

describe('addGrpcReference', () => {
    let root: string;
    let client: string;
    let web: string;
    const shared = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-add-')));
        fs.cpSync(fixture, root, { recursive: true });
        client = path.join(root, 'Client', 'Client.csproj');
        web = path.join(root, 'Web', 'Web.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** A host that answers like the user and NuGet would; installPackages writes bare references, as the CPM edits do */
    const host = (overrides: Partial<GrpcHost> = {}) => {
        const calls = { info: [] as string[], fail: [] as string[], asked: [] as string[], installed: [] as string[], reevaluated: [] as string[], preselected: [] as string[] };
        const fake: GrpcHost = {
            pickSource: async () => ({ kind: 'file', path: shared() }),
            pickServices: async preselected => { calls.preselected.push(preselected); return preselected; },
            ask: async message => { calls.asked.push(message); return false; },
            info: message => { calls.info.push(message); },
            fail: message => { calls.fail.push(message); },
            log: () => undefined,
            progress: (_title, task) => task(),
            download: async () => Buffer.from('syntax = "proto3";\n'),
            items: async () => parseMsbuildItems(JSON.stringify({ Items: {} }), root),
            referencedPackages: async () => [],
            latestVersion: async id => ({ 'Google.Protobuf': '3.30.2', 'Grpc.Net.ClientFactory': '2.71.0', 'Grpc.Tools': '2.71.0', 'Grpc.AspNetCore': '2.71.0' } as Record<string, string>)[id],
            installPackages: async (projectPath, packages) => {
                calls.installed.push(...packages.map(entry => `${entry.id} ${entry.version}`));
                const content = fs.readFileSync(projectPath, 'utf8');
                const references = packages.map(entry => `    <PackageReference Include="${entry.id}" />\n`).join('');
                fs.writeFileSync(projectPath, content.replace('</Project>', `  <ItemGroup>\n${references}  </ItemGroup>\n</Project>`));
                return packages.map(entry => ({ success: true, message: `${entry.id} ${entry.version}` }));
            },
            reevaluate: async projectPath => { calls.reevaluated.push(projectPath); },
            ...overrides,
        };
        return { fake, calls };
    };

    test('a .proto outside a console project: Client, a Link into Protos, the client packages with Grpc.Tools private', async () => {
        const { fake, calls } = host();
        expect(await addGrpcReference(client, fake)).toBe(true);
        const content = fs.readFileSync(client, 'utf8');
        expect(content).toContain('    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />\n');
        expect(content).toContain('<PackageReference Include="Grpc.Tools">\n      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n');
        expect(calls.preselected).toEqual(['Client']);
        expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        expect(calls.reevaluated).toEqual([client]);
        expect(calls.info).toEqual(['gRPC reference greet.proto added (Client). The code is generated when the project builds.']);
        expect(calls.fail).toEqual([]);
    });

    test('a web project offers Both first and gets Grpc.AspNetCore', async () => {
        const { fake, calls } = host();
        await addGrpcReference(web, fake);
        expect(calls.preselected).toEqual(['Both']);
        expect(fs.readFileSync(web, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />');
        expect(calls.installed).toEqual(['Grpc.AspNetCore 2.71.0']);
    });

    test('packages the project has are left alone', async () => {
        const { fake, calls } = host({ referencedPackages: async () => ['Grpc.AspNetCore'] });
        await addGrpcReference(client, fake);
        expect(calls.installed).toEqual([]);
        expect(calls.info).toHaveLength(1);
    });

    test('a URL: downloaded into Protos (created), referenced with its SourceUrl', async () => {
        const { fake } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }) });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(fs.readFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'utf8')).toBe('syntax = "proto3";\n');
        expect(fs.readFileSync(client, 'utf8')).toContain(
            '    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client">\n      <SourceUrl>https://example.com/protos/greet.proto</SourceUrl>\n    </Protobuf>\n');
    });

    test('a URL whose file exists with other content: asked first; No changes nothing', async () => {
        fs.mkdirSync(path.join(root, 'Client', 'Protos'));
        fs.writeFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'old');
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }) });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.asked).toEqual([`${path.join('Protos', 'greet.proto')} exists already.`]);
        expect(fs.readFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'utf8')).toBe('old');
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('a failed download changes nothing and says so', async () => {
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }), download: async () => { throw new Error('404'); } });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.fail).toEqual([`Downloading ${GREET_URL} failed.`]);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(root, 'Client', 'Protos'))).toBe(false);
    });

    test('a file the project references already is refused', async () => {
        const items = parseMsbuildItems(JSON.stringify({ Items: { Protobuf: [{ Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto' }] } }), root);
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ items: async () => items });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.info).toEqual(['greet.proto is already a gRPC reference of Client.']);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('packages not found: the reference stays, the error says the packages failed', async () => {
        const { fake, calls } = host({ latestVersion: async () => undefined });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(fs.readFileSync(client, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto"');
        expect(calls.fail).toEqual(['gRPC reference greet.proto added, but adding its packages failed.']);
    });

    test('cancelled at the source or at what to generate: nothing changes', async () => {
        const before = fs.readFileSync(client, 'utf8');
        expect(await addGrpcReference(client, host({ pickSource: async () => undefined }).fake)).toBe(false);
        expect(await addGrpcReference(client, host({ pickServices: async () => undefined }).fake)).toBe(false);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });
});

describe('addGrpcReference under Central Package Management (the packages go through changePackageVersions)', () => {
    const cpmFixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');
    const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
    let root: string;
    let app: string;
    let legacy: string;
    const props = () => path.join(root, 'Directory.Packages.props');
    const versions: Record<string, string> = { 'Google.Protobuf': '3.30.2', 'Grpc.Net.ClientFactory': '2.71.0', 'Grpc.Tools': '2.71.0' };

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-cpm-')));
        fs.cpSync(cpmFixture, root, { recursive: true });
        fs.cpSync(path.join(fixture, 'shared'), path.join(root, 'shared'), { recursive: true });
        app = path.join(root, 'App', 'App.csproj');
        legacy = path.join(root, 'Legacy', 'Legacy.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** The operations host of the CPM code with the given project states; installs (dotnet add package) recorded */
    const operations = (states: OperationsHost['states']) => {
        const installs: string[] = [];
        const ops: OperationsHost = {
            ask: async () => undefined,
            states,
            install: async (projectPath, id, version) => { installs.push(`${path.basename(projectPath)} ${id} ${version}`); return { success: true, message: `${id} ${version}` }; },
            uninstall: async () => ({ success: true, message: '' }),
            restore: async () => ({ success: true, message: 'restored' }),
            solutionPath: () => path.join(root, 'Central.slnx'),
            reevaluate: async () => undefined,
        };
        return { ops, installs };
    };
    /** App and Legacy as MSBuild evaluates them (see centralPackageOperations.test.ts), without running MSBuild */
    const fixtureStates = async (): Promise<ProjectState[]> => {
        const state = (projectPath: string, cpm: boolean, references: object[]): ProjectState => ({
            name: path.basename(projectPath, '.csproj'), path: projectPath, packages: parseMsbuildPackages(JSON.stringify({
                Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props() },
                Items: {
                    PackageReference: references.map(reference => ({ DefiningProjectFullPath: projectPath, ...reference })),
                    PackageVersion: [
                        { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props() },
                        { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props() },
                    ],
                },
            }), projectPath) as ProjectPackages,
        });
        return [
            state(app, true, [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }]),
            state(legacy, false, [{ Identity: 'Polly', Version: '8.0.0' }]),
        ];
    };
    const grpcHost = (ops: OperationsHost): GrpcHost => ({
        pickSource: async () => ({ kind: 'file', path: path.join(root, 'shared', 'greet.proto') }),
        pickServices: async preselected => preselected,
        ask: async () => false,
        info: () => undefined,
        fail: message => { throw new Error(message); },
        log: () => undefined,
        progress: (_title, task) => task(),
        download: async () => Buffer.alloc(0),
        items: async () => undefined,
        referencedPackages: async () => [],
        latestVersion: async id => versions[id],
        installPackages: (projectPath, packages) => installGrpcPackages(projectPath, packages, ops),
        reevaluate: async () => undefined,
    });

    test('a CPM project: central PackageVersions, bare PackageReferences, Grpc.Tools marked private; no dotnet add package', async () => {
        const { ops, installs } = operations(fixtureStates);
        expect(await addGrpcReference(app, grpcHost(ops))).toBe(true);
        const central = fs.readFileSync(props(), 'utf8');
        expect(central).toContain('<PackageVersion Include="Google.Protobuf" Version="3.30.2" />');
        expect(central).toContain('<PackageVersion Include="Grpc.Net.ClientFactory" Version="2.71.0" />');
        expect(central).toContain('<PackageVersion Include="Grpc.Tools" Version="2.71.0" />');
        const project = fs.readFileSync(app, 'utf8');
        expect(project).toContain('<PackageReference Include="Google.Protobuf" />');
        expect(project).toContain('<PackageReference Include="Grpc.Net.ClientFactory" />');
        expect(project).toMatch(/<PackageReference Include="Grpc.Tools">\r?\n\s*<IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive<\/IncludeAssets>\r?\n\s*<PrivateAssets>all<\/PrivateAssets>\r?\n\s*<\/PackageReference>/);
        expect(project).not.toMatch(/Include="(Google\.Protobuf|Grpc\.[A-Za-z.]+)"[^>]*Version=/);
        expect(project).toContain('<Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />');
        expect(installs).toEqual([]);
    });

    test('a project that turned CPM off: dotnet add package with the versions, the props file untouched', async () => {
        const { ops, installs } = operations(fixtureStates);
        const before = fs.readFileSync(props(), 'utf8');
        expect(await addGrpcReference(legacy, grpcHost(ops))).toBe(true);
        expect(installs).toEqual(['Legacy.csproj Google.Protobuf 3.30.2', 'Legacy.csproj Grpc.Net.ClientFactory 2.71.0', 'Legacy.csproj Grpc.Tools 2.71.0']);
        expect(fs.readFileSync(props(), 'utf8')).toBe(before);
    });

    withDotnet('against real MSBuild: the project evaluated before and after; the gRPC packages take their central versions', async () => {
        const evaluate = async (projectPath: string) => {
            const packages = await new ProjectItemsService().evaluatePackages(projectPath);
            if (!packages) {
                throw new Error(`MSBuild could not evaluate ${projectPath}`);
            }
            return packages;
        };
        const { ops, installs } = operations(async () => [{ name: 'App', path: app, packages: await evaluate(app) }]);
        expect(await addGrpcReference(app, grpcHost(ops))).toBe(true);
        expect(installs).toEqual([]);
        const after = (await evaluate(app)).references.filter(reference => /^(Google|Grpc)\./.test(reference.id))
            .map(reference => `${reference.id} ${reference.version} ${reference.source} ${path.basename(reference.versionFile ?? '-')}`);
        expect(after).toEqual([
            'Google.Protobuf 3.30.2 central Directory.Packages.props',
            'Grpc.Net.ClientFactory 2.71.0 central Directory.Packages.props',
            'Grpc.Tools 2.71.0 central Directory.Packages.props',
        ]);
    }, 150000);
});
