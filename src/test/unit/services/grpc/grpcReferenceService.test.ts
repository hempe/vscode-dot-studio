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
import { DownloadCancelled } from '../../../../services/grpc/download';
import { addGrpcReference, GrpcHost, installGrpcPackages, vscodeGrpcHost } from '../../../../services/grpc/grpcReferenceService';
import { PackageBrowseService } from '../../../../services/nuget/packageBrowseService';
import { OperationsHost } from '../../../../services/nuget/centralPackageOperations';
import { PackageOperationsService } from '../../../../services/nuget/packageOperationsService';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';
import { ProjectItemsService } from '../../../../services/project/items/projectItemsService';
import { parseMsbuildItems } from '../../../../services/project/items/projectItems';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
const GREET_URL = 'https://example.com/protos/greet.proto';
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;

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
            dependencyMinimum: async () => undefined,
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
        const { fake, calls } = host({ referencedPackages: async () => [{ id: 'Grpc.AspNetCore', version: '2.71.0' }] });
        await addGrpcReference(client, fake);
        expect(calls.installed).toEqual([]);
        expect(calls.info).toHaveLength(1);
    });

    describe('a project that pins an older Google.Protobuf than the new packages need (NU1605 at restore)', () => {
        const pinned = (version: string, ask: (message: string) => boolean) => host({
            referencedPackages: async () => [{ id: 'Google.Protobuf', version }],
            dependencyMinimum: async (id, version, dependency) => id === 'Grpc.AspNetCore' && version === '2.71.0' && dependency === 'Google.Protobuf' ? '3.30.2' : undefined,
            ask: async message => ask(message),
        });

        test('asks, then raises Google.Protobuf to what the packages need, before adding them', async () => {
            const asked: string[] = [];
            const { fake, calls } = pinned('3.20.0', message => { asked.push(message); return true; });
            expect(await addGrpcReference(web, fake)).toBe(true);
            expect(asked).toEqual(['Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer; Web has 3.20.0.']);
            expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.AspNetCore 2.71.0']);
            expect(calls.info).toEqual(['gRPC reference greet.proto added (Both). The code is generated when the project builds.']);
            expect(calls.fail).toEqual([]);
        });

        test('kept: the reference is added without the packages, and the message says what to raise', async () => {
            const { fake, calls } = pinned('3.20.0', () => false);
            expect(await addGrpcReference(web, fake)).toBe(true);
            expect(fs.readFileSync(web, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />');
            expect(calls.installed).toEqual([]);
            expect(calls.info).toEqual(['gRPC reference greet.proto added, but not its packages: Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer '
                + 'and Web keeps 3.20.0. Raise Google.Protobuf, then add the same reference again: that adds the missing packages.']);
            expect(calls.fail).toEqual([]);
        });

        test('kept on Add again (the reference is there already): its missing packages are not added, the message says why', async () => {
            fs.writeFileSync(web, fs.readFileSync(web, 'utf8').replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />\n  </ItemGroup>\n</Project>'));
            const { fake, calls } = pinned('3.20.0', () => false);
            expect(await addGrpcReference(web, fake)).toBe(false);
            expect(calls.installed).toEqual([]);
            expect(calls.info).toEqual(['greet.proto is a gRPC reference already; its missing packages were not added: Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 '
                + 'or newer and Web keeps 3.20.0. Raise Google.Protobuf, then add the same reference again: that adds the missing packages.']);
            expect(calls.fail).toEqual([]);
        });

        test('a Google.Protobuf that is new enough, or not known, is left alone without a question', async () => {
            for (const version of ['3.30.2', '3.31.0', '']) {
                const asked: string[] = [];
                const { fake, calls } = pinned(version, message => { asked.push(message); return true; });
                expect(await addGrpcReference(web, fake)).toBe(true);
                expect(asked).toEqual([]);
                expect(calls.installed).toEqual(['Grpc.AspNetCore 2.71.0']);
                fs.cpSync(path.join(fixture, 'Web', 'Web.csproj'), web);
            }
        });

        test('Client packages do not depend on Google.Protobuf: nothing is asked (the project keeps its version)', async () => {
            const asked: string[] = [];
            const { fake, calls } = pinned('3.20.0', message => { asked.push(message); return true; });
            expect(await addGrpcReference(client, fake)).toBe(true);
            expect(asked).toEqual([]);
            expect(calls.installed).toEqual(['Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        });
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
        expect(calls.fail).toEqual([`Adding gRPC reference greet.proto failed: ${GREET_URL} could not be downloaded. Nothing was changed.`]);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(root, 'Client', 'Protos'))).toBe(false);
    });

    test('a file the project references already is refused', async () => {
        const items = parseMsbuildItems(JSON.stringify({ Items: { Protobuf: [{ Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto' }] } }), root);
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ items: async () => items, referencedPackages: async () => [{ id: 'Grpc.AspNetCore', version: '2.71.0' }] });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.info).toEqual(['greet.proto is already a gRPC reference of Client.']);
        expect(calls.installed).toEqual([]);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('packages not found: the reference stays, the error says the packages failed', async () => {
        const { fake, calls } = host({ latestVersion: async () => undefined });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(fs.readFileSync(client, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto"');
        expect(calls.fail).toEqual(['gRPC reference greet.proto added, but adding its packages failed. '
            + 'Once the package sources can be reached, add the same reference again: that adds the missing packages.']);
    });

    test('Add again after the packages failed (offline): the missing packages are added, the item is not written twice', async () => {
        const offline = host({ latestVersion: async () => undefined, items: async () => undefined });
        expect(await addGrpcReference(client, offline.fake)).toBe(true);
        const halfDone = fs.readFileSync(client, 'utf8');
        // MSBuild could not tell (items undefined): the project file text says it is there
        const { fake, calls } = host({ items: async () => undefined });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        expect(calls.info).toEqual(['greet.proto was a gRPC reference already; its missing packages were added. The code is generated when the project builds.']);
        const content = fs.readFileSync(client, 'utf8');
        expect(content.match(/<Protobuf /g)).toHaveLength(1);
        expect(content.startsWith(halfDone.replace(/\n<\/Project>\n$/, ''))).toBe(true);
        expect(content).toContain('<PrivateAssets>all</PrivateAssets>');
    });

    withDotnet('Add again after the packages failed, evaluated by real MSBuild: the item\'s GrpcServices decide the packages', async () => {
        const offline = host({ latestVersion: async () => undefined });
        expect(await addGrpcReference(client, offline.fake)).toBe(true);
        // This time Both is picked; the item says Client
        const { fake, calls } = host({
            pickServices: async () => 'Both',
            items: projectPath => new ProjectItemsService().evaluate(projectPath),
            referencedPackages: async projectPath => (await new ProjectItemsService().evaluatePackages(projectPath))?.references ?? [],
        });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        expect(fs.readFileSync(client, 'utf8').match(/<Protobuf /g)).toHaveLength(1);
    }, 150000);

    test('a URL answered with an HTML page (a sign-in page) or nothing: refused, the local file and the project stay', async () => {
        fs.mkdirSync(path.join(root, 'Client', 'Protos'));
        fs.writeFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'old');
        const before = fs.readFileSync(client, 'utf8');
        for (const answer of ['\n<!DOCTYPE html><html><body>Sign in</body></html>', '']) {
            const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }), download: async () => Buffer.from(answer), ask: async () => true });
            expect(await addGrpcReference(client, fake)).toBe(false);
            expect(calls.asked).toEqual([]);
            expect(calls.fail).toEqual([expect.stringMatching(new RegExp(`^Adding gRPC reference greet.proto failed: ${GREET_URL} did not send a .proto file \\((it answered with a web page|the answer was empty).*Nothing was changed\\.$`))]);
        }
        expect(fs.readFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'utf8')).toBe('old');
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('credentials in the URL are not shown or logged, but are used and stored as written', async () => {
        const url = 'https://user:s3cret@example.com/protos/greet.proto?token=TOPSECRET';
        const shown: string[] = [];
        const downloaded: string[] = [];
        const failing = host({
            pickSource: async () => ({ kind: 'url', url }), log: line => { shown.push(line); },
            download: async requested => { downloaded.push(requested); throw new Error('https://***@example.com/protos/greet.proto?*** answered 500'); },
        });
        await addGrpcReference(client, failing.fake);
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url }), log: line => { shown.push(line); } });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(downloaded).toEqual([url]);
        expect([...shown, ...failing.calls.fail, ...calls.info, ...calls.fail].join('\n')).not.toMatch(/s3cret|TOPSECRET/);
        expect(failing.calls.fail).toEqual(['Adding gRPC reference greet.proto failed: https://***@example.com/protos/greet.proto?*** could not be downloaded. Nothing was changed.']);
        expect(fs.readFileSync(client, 'utf8')).toContain(`<SourceUrl>${url}</SourceUrl>`);
    });

    test('a cancelled download changes nothing and is no error', async () => {
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }), download: async () => { throw new DownloadCancelled(); } });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.fail).toEqual([]);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    withDotnet('a URL whose file would be where a linked reference is shown (Consumer: Link="Protos\\greet.proto") is refused before downloading', async () => {
        const consumer = path.join(root, 'Consumer', 'Consumer.csproj');
        const before = fs.readFileSync(consumer, 'utf8');
        const downloaded: string[] = [];
        const { fake, calls } = host({
            pickSource: async () => ({ kind: 'url', url: GREET_URL }),
            items: projectPath => new ProjectItemsService().evaluate(projectPath),
            download: async url => { downloaded.push(url); return Buffer.from('syntax = "proto3";\n'); },
        });
        expect(await addGrpcReference(consumer, fake)).toBe(false);
        // MSBuild on Linux and macOS reports the Include with forward slashes
        expect(calls.info).toEqual([expect.stringMatching(/^Protos\\greet\.proto is already taken by the gRPC reference \.\.[\\/]shared[\\/]greet\.proto; rename one of the files\.$/)]);
        expect(downloaded).toEqual([]);
        expect(fs.readFileSync(consumer, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(root, 'Consumer', 'Protos', 'greet.proto'))).toBe(false);
    }, 150000);

    test('cancelled at the source or at what to generate: nothing changes', async () => {
        const before = fs.readFileSync(client, 'utf8');
        expect(await addGrpcReference(client, host({ pickSource: async () => undefined }).fake)).toBe(false);
        expect(await addGrpcReference(client, host({ pickServices: async () => undefined }).fake)).toBe(false);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });
});

describe('addGrpcReference under Central Package Management (the packages go through changePackageVersions)', () => {
    const cpmFixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');
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
        dependencyMinimum: async () => undefined,
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

    test('a CPM project with an older central Google.Protobuf: Raise sets the central version, with the new package in the same batch', async () => {
        fs.writeFileSync(props(), fs.readFileSync(props(), 'utf8').replace('<PackageVersion Include="Serilog" Version="3.1.1" />',
            '<PackageVersion Include="Serilog" Version="3.1.1" />\n    <PackageVersion Include="Google.Protobuf" Version="3.20.0" />'));
        fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace('<PackageReference Include="Polly" />', '<PackageReference Include="Polly" />\n    <PackageReference Include="Google.Protobuf" />'));
        const states = async (): Promise<ProjectState[]> => [{
            name: 'App', path: app, packages: parseMsbuildPackages(JSON.stringify({
                Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props() },
                Items: {
                    PackageReference: [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }, { Identity: 'Google.Protobuf' }].map(reference => ({ DefiningProjectFullPath: app, ...reference })),
                    PackageVersion: [['Newtonsoft.Json', '13.0.1'], ['Serilog', '3.1.1'], ['Google.Protobuf', '3.20.0']]
                        .map(([id, version]) => ({ Identity: id, Version: version, DefiningProjectFullPath: props() })),
                },
            }), app) as ProjectPackages,
        }];
        const { ops, installs } = operations(states);
        const asked: string[] = [];
        expect(await addGrpcReference(app, {
            ...grpcHost(ops),
            pickServices: async () => 'Server',
            referencedPackages: async () => (await states())[0].packages!.references,
            latestVersion: async id => ({ ...versions, 'Grpc.AspNetCore': '2.71.0' } as Record<string, string>)[id],
            dependencyMinimum: async (id, version, dependency) => id === 'Grpc.AspNetCore' && version === '2.71.0' && dependency === 'Google.Protobuf' ? '3.30.2' : undefined,
            ask: async message => { asked.push(message); return true; },
        })).toBe(true);
        expect(asked).toEqual(['Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer; App has 3.20.0.']);
        const central = fs.readFileSync(props(), 'utf8');
        expect(central).toContain('<PackageVersion Include="Google.Protobuf" Version="3.30.2" />');
        expect(central).toContain('<PackageVersion Include="Grpc.AspNetCore" Version="2.71.0" />');
        expect(central).not.toContain('3.20.0');
        expect(fs.readFileSync(app, 'utf8')).toContain('<PackageReference Include="Grpc.AspNetCore" />');
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

/**
 * The NU1605 a pinned older Google.Protobuf gives, with the real `dotnet add package` and `dotnet restore` (packages
 * from nuget.org or the NuGet cache). Pinned versions: Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer.
 */
describe('addGrpcReference to a project with an older Google.Protobuf, with real dotnet add package and restore', () => {
    const PINNED = '3.20.0';
    const NEEDED = '3.30.2';
    let root: string;
    let web: string;
    const restore = (target: string) => spawnSync('dotnet', ['restore', target], { encoding: 'utf8' });
    const unreachable = (output: string) => /NU1301|Unable to load the service index|NU1101|NU1102/.test(output);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-nu1605-')));
        fs.cpSync(fixture, root, { recursive: true });
        web = path.join(root, 'Web', 'Web.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** Web with `<PackageReference Include="Google.Protobuf" .../>`; under CPM the version is in Directory.Packages.props */
    const pin = (cpm: boolean) => {
        const reference = cpm ? '<PackageReference Include="Google.Protobuf" />' : `<PackageReference Include="Google.Protobuf" Version="${PINNED}" />`;
        fs.writeFileSync(web, fs.readFileSync(web, 'utf8').replace('</Project>', `  <ItemGroup>\n    ${reference}\n  </ItemGroup>\n\n</Project>`));
        if (cpm) {
            fs.writeFileSync(path.join(root, 'Directory.Packages.props'), '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n'
                + `  </PropertyGroup>\n  <ItemGroup>\n    <PackageVersion Include="Google.Protobuf" Version="${PINNED}" />\n  </ItemGroup>\n</Project>\n`);
        }
    };

    /** False (with a warning) when dotnet cannot restore the pinned project: no network and not in the NuGet cache */
    const canRestore = () => {
        if (spawnSync('dotnet', ['--version']).status !== 0) {
            console.warn('Skipped: dotnet is not available');
            return false;
        }
        const result = restore(web);
        if (result.status !== 0) {
            console.warn(`Skipped: the pinned project does not restore (nuget.org not reachable, Google.Protobuf ${PINNED} not in the NuGet cache?)`);
            return false;
        }
        return true;
    };

    const ops = (solutionPath?: string): OperationsHost => ({
        ask: async (_message, _detail, ...buttons) => buttons[0],
        states: async projects => Promise.all(projects.map(async projectPath => ({
            name: path.basename(projectPath, '.csproj'), path: projectPath, packages: await new ProjectItemsService().evaluatePackages(projectPath),
        }))),
        install: (projectPath, id, version) => PackageOperationsService.installPackage({ packageId: id, version, projectPath }),
        uninstall: async () => ({ success: true, message: '' }),
        restore: async target => {
            const result = restore(target);
            return { success: result.status === 0, message: result.stdout + result.stderr };
        },
        solutionPath: () => solutionPath,
        reevaluate: async () => undefined,
    });

    const realHost = (raise: boolean, operations: OperationsHost) => {
        const calls = { asked: [] as string[], info: [] as string[], fail: [] as string[], log: [] as string[] };
        const host: GrpcHost = {
            pickSource: async () => ({ kind: 'file', path: path.join(root, 'shared', 'greet.proto') }),
            pickServices: async () => 'Both',
            ask: async message => { calls.asked.push(message); return raise; },
            info: message => { calls.info.push(message); },
            fail: message => { calls.fail.push(message); },
            log: line => { calls.log.push(line); },
            progress: (_title, task) => task(),
            download: async () => Buffer.alloc(0),
            items: projectPath => new ProjectItemsService().evaluate(projectPath),
            referencedPackages: async projectPath => (await new ProjectItemsService().evaluatePackages(projectPath))?.references ?? [],
            latestVersion: async id => ({ 'Grpc.AspNetCore': '2.71.0' } as Record<string, string>)[id],
            dependencyMinimum: async (id, version, dependency) => id === 'Grpc.AspNetCore' && version === '2.71.0' && dependency === 'Google.Protobuf' ? NEEDED : undefined,
            installPackages: (projectPath, packages) => installGrpcPackages(projectPath, packages, operations),
            reevaluate: async () => undefined,
        };
        return { host, calls };
    };

    test('the bug: dotnet add package Grpc.AspNetCore on the pinned project fails with NU1605 (package downgrade)', () => {
        pin(false);
        if (!canRestore()) {
            return;
        }
        const added = spawnSync('dotnet', ['add', web, 'package', 'Grpc.AspNetCore', '--version', '2.71.0'], { encoding: 'utf8' });
        if (added.status !== 0 && unreachable(added.stdout + added.stderr)) {
            console.warn('Skipped: Grpc.AspNetCore 2.71.0 is not reachable and not in the NuGet cache');
            return;
        }
        expect(added.stdout + added.stderr).toContain(`NU1605`);
        expect(added.stdout + added.stderr).toContain(`Google.Protobuf from ${NEEDED} to ${PINNED}`);
    }, 300000);

    test('Raise: Google.Protobuf goes to the version Grpc.AspNetCore needs first, then the package; the project restores', async () => {
        pin(false);
        if (!canRestore()) {
            return;
        }
        const { host, calls } = realHost(true, ops());
        expect(await addGrpcReference(web, host)).toBe(true);
        if (calls.fail.length > 0 && unreachable(calls.log.join('\n'))) {
            console.warn('Skipped: Grpc.AspNetCore 2.71.0 is not reachable and not in the NuGet cache');
            return;
        }
        expect(calls.asked).toEqual([`Grpc.AspNetCore 2.71.0 needs Google.Protobuf ${NEEDED} or newer; Web has ${PINNED}.`]);
        expect(calls.fail).toEqual([]);
        expect(calls.info).toEqual(['gRPC reference greet.proto added (Both). The code is generated when the project builds.']);
        const content = fs.readFileSync(web, 'utf8');
        expect(content).toContain(`<PackageReference Include="Google.Protobuf" Version="${NEEDED}" />`);
        expect(content).toContain('<PackageReference Include="Grpc.AspNetCore" Version="2.71.0" />');
        const restored = restore(web);
        expect(restored.stdout + restored.stderr).not.toContain('NU1605');
        expect(restored.status).toBe(0);
    }, 300000);

    test('Raise under Central Package Management: the central version is raised; the project restores', async () => {
        pin(true);
        if (!canRestore()) {
            return;
        }
        const { host, calls } = realHost(true, ops());
        expect(await addGrpcReference(web, host)).toBe(true);
        if (calls.fail.length > 0 && unreachable(calls.log.join('\n'))) {
            console.warn('Skipped: Grpc.AspNetCore 2.71.0 is not reachable and not in the NuGet cache');
            return;
        }
        expect(calls.asked).toEqual([`Grpc.AspNetCore 2.71.0 needs Google.Protobuf ${NEEDED} or newer; Web has ${PINNED}.`]);
        expect(calls.fail).toEqual([]);
        const central = fs.readFileSync(path.join(root, 'Directory.Packages.props'), 'utf8');
        expect(central).toContain(`<PackageVersion Include="Google.Protobuf" Version="${NEEDED}" />`);
        expect(central).toContain('<PackageVersion Include="Grpc.AspNetCore" Version="2.71.0" />');
        const restored = restore(web);
        expect(restored.stdout + restored.stderr).not.toContain('NU1605');
        expect(restored.status).toBe(0);
    }, 300000);

    test('Keep: only the <Protobuf> item is added, no package; the project still restores', async () => {
        pin(false);
        if (!canRestore()) {
            return;
        }
        const { host, calls } = realHost(false, ops());
        expect(await addGrpcReference(web, host)).toBe(true);
        expect(calls.asked).toHaveLength(1);
        expect(calls.info).toEqual([`gRPC reference greet.proto added, but not its packages: Grpc.AspNetCore 2.71.0 needs Google.Protobuf ${NEEDED} or newer `
            + `and Web keeps ${PINNED}. Raise Google.Protobuf, then add the same reference again: that adds the missing packages.`]);
        const content = fs.readFileSync(web, 'utf8');
        expect(content).toContain('<Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />');
        expect(content).toContain(`<PackageReference Include="Google.Protobuf" Version="${PINNED}" />`);
        expect(content).not.toContain('Grpc.AspNetCore');
        expect(restore(web).status).toBe(0);
    }, 300000);
});

describe('vscodeGrpcHost.dependencyMinimum', () => {
    afterEach(() => jest.restoreAllMocks());

    test('the highest lower bound over the target frameworks of that version; undefined without such a dependency', async () => {
        jest.spyOn(PackageBrowseService, 'getPackageDetails').mockResolvedValue({
            id: 'Grpc.AspNetCore', currentVersion: '2.84.0', dependencies: {
                '2.84.0': [{ id: 'Google.Protobuf', range: '[3.30.0, )' }, { id: 'google.protobuf', range: '[3.35.1, )' }, { id: 'Grpc.Tools', range: '[2.84.0, )' }],
            },
        });
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.84.0', 'Google.Protobuf')).toBe('3.35.1');
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.71.0', 'Google.Protobuf')).toBeUndefined();
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.84.0', 'Serilog')).toBeUndefined();
    });
});
