jest.mock('vscode', () => ({
    window: { createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GrpcHost, removeGrpcReference, updateGrpcReference } from '../../../../services/grpc/grpcReferenceService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
const REMOTE_URL = 'https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto';

/** Update and Remove on the Consumer project of src/__fixtures__/grpc (a linked, a URL and a wildcard reference) */
describe('updateGrpcReference and removeGrpcReference', () => {
    let root: string;
    let consumer: string;
    let dir: string;
    const remote = () => path.join(dir, 'Protos', 'remote.proto');
    const shared = () => path.join(root, 'shared', 'greet.proto');
    const money = () => path.join(dir, 'Contracts', 'money.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-update-')));
        fs.cpSync(fixture, root, { recursive: true });
        dir = path.join(root, 'Consumer');
        consumer = path.join(dir, 'Consumer.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    // What MSBuild reports for Consumer.csproj
    const evaluation = () => parseMsbuildItems(JSON.stringify({
        Items: {
            Protobuf: [
                { Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto', GrpcServices: 'Client', DefiningProjectFullPath: consumer },
                { Identity: 'Protos\\remote.proto', FullPath: remote(), GrpcServices: 'Client', SourceUrl: REMOTE_URL, DefiningProjectFullPath: consumer },
                { Identity: 'Contracts/money.proto', FullPath: money(), GrpcServices: 'None', DefiningProjectFullPath: consumer },
            ],
        },
    }), dir);

    const host = (overrides: Partial<GrpcHost> = {}) => {
        const calls = { info: [] as string[], fail: [] as string[], asked: [] as string[], downloaded: [] as string[], reevaluated: [] as string[] };
        const fake: GrpcHost = {
            pickSource: async () => undefined,
            pickServices: async () => undefined,
            ask: async message => { calls.asked.push(message); return true; },
            info: message => { calls.info.push(message); },
            fail: message => { calls.fail.push(message); },
            log: () => undefined,
            progress: (_title, task) => task(),
            download: async url => { calls.downloaded.push(url); return Buffer.from('syntax = "proto3"; // new\n'); },
            items: async () => evaluation(),
            referencedPackages: async () => [],
            latestVersion: async () => undefined,
            installPackages: async () => [],
            reevaluate: async projectPath => { calls.reevaluated.push(projectPath); },
            ...overrides,
        };
        return { fake, calls };
    };

    test('Update downloads from SourceUrl and replaces the file when it differs', async () => {
        const { fake, calls } = host();
        expect(await updateGrpcReference(consumer, remote(), fake)).toBe(true);
        expect(calls.downloaded).toEqual([REMOTE_URL]);
        expect(fs.readFileSync(remote(), 'utf8')).toBe('syntax = "proto3"; // new\n');
        expect(calls.info).toEqual([`remote.proto updated from ${REMOTE_URL}. The code is generated again when the project builds.`]);
    });

    test('Update with the same content leaves the file alone (its time stamp too)', async () => {
        const stamp = new Date(2020, 0, 1);
        fs.utimesSync(remote(), stamp, stamp);
        const same = fs.readFileSync(remote());
        const { fake, calls } = host({ download: async () => same });
        expect(await updateGrpcReference(consumer, remote(), fake)).toBe(false);
        expect(calls.info).toEqual(['remote.proto is up to date.']);
        expect(fs.statSync(remote()).mtimeMs).toBe(stamp.getTime());
    });

    test('Update of a reference without a URL, or a failed download, changes nothing', async () => {
        const before = fs.readFileSync(remote(), 'utf8');
        const local = host();
        expect(await updateGrpcReference(consumer, shared(), local.fake)).toBe(false);
        expect(local.calls.info).toEqual(['greet.proto was not added from a URL: there is nothing to update it from.']);
        const failing = host({ download: async () => { throw new Error('404'); } });
        expect(await updateGrpcReference(consumer, remote(), failing.fake)).toBe(false);
        expect(failing.calls.fail).toEqual([`Updating remote.proto failed: ${REMOTE_URL} could not be downloaded.`]);
        expect(fs.readFileSync(remote(), 'utf8')).toBe(before);
    });

    test('Remove asks, takes the item out (the block with SourceUrl too) and keeps the file', async () => {
        const { fake, calls } = host();
        expect(await removeGrpcReference(consumer, remote(), fake)).toBe(true);
        expect(calls.asked).toEqual(["Remove the gRPC reference 'remote.proto'?"]);
        const content = fs.readFileSync(consumer, 'utf8');
        expect(content).not.toContain('remote.proto');
        expect(content).not.toContain('SourceUrl');
        expect(content).toContain('<Protobuf Include="..\\shared\\greet.proto"');
        expect(fs.existsSync(remote())).toBe(true);
        expect(calls.reevaluated).toEqual([consumer]);
    });

    test('Remove answered with Cancel changes nothing', async () => {
        const before = fs.readFileSync(consumer, 'utf8');
        const { fake } = host({ ask: async () => false });
        expect(await removeGrpcReference(consumer, shared(), fake)).toBe(false);
        expect(fs.readFileSync(consumer, 'utf8')).toBe(before);
    });

    test('Remove of a file a wildcard includes is refused with what to do', async () => {
        const before = fs.readFileSync(consumer, 'utf8');
        const { fake, calls } = host();
        expect(await removeGrpcReference(consumer, money(), fake)).toBe(false);
        expect(calls.asked).toEqual([]);
        expect(calls.info).toEqual(['money.proto is not listed by itself in Consumer.csproj (a wildcard such as Protos\\*.proto includes it): edit the project file.']);
        expect(fs.readFileSync(consumer, 'utf8')).toBe(before);
    });
});
