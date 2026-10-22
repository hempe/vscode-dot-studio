jest.mock('vscode', () => {
    const watcher = () => ({ onDidCreate: jest.fn(), onDidChange: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() });
    return {
        workspace: { createFileSystemWatcher: jest.fn(watcher), workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        commands: { executeCommand: jest.fn() },
    };
}, { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../../../core/Project';
import { grpcChildren } from '../../../../services/grpc/grpcNodes';
import { NodeIdService } from '../../../../services/nodeIdService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';
import { ShowAllFiles } from '../../../../services/showAllFiles';

describe('gRPC references in the tree', () => {
    let root: string;
    let dir: string;
    let projectPath: string;
    const shared = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-tree-')));
        dir = path.join(root, 'App');
        fs.mkdirSync(path.join(dir, 'Protos'), { recursive: true });
        projectPath = path.join(dir, 'App.csproj');
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        fs.writeFileSync(path.join(dir, 'Program.cs'), '');
        fs.writeFileSync(path.join(dir, 'Protos', 'remote.proto'), '');
        jest.spyOn(ShowAllFiles, 'isOn').mockReturnValue(false);
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: {
                Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }],
                // What the default globs give a service reference folder
                None: [{ Identity: 'Connected Services\\Billing\\ConnectedService.json', FullPath: path.join(dir, 'Connected Services', 'Billing', 'ConnectedService.json') }],
                Protobuf: [
                    { Identity: 'Protos\\remote.proto', FullPath: path.join(dir, 'Protos', 'remote.proto'), GrpcServices: 'Client', SourceUrl: 'https://example.com/remote.proto' },
                    { Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto' },
                ],
            },
        }), dir));
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const newProject = async () => {
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return project;
    };
    const expectedReferences = () => [
        { type: 'grpcReference', name: 'greet.proto (Both)', nodeId: NodeIdService.generateGrpcReferenceId(projectPath, shared()), hasChildren: false },
        { type: 'grpcReference', name: 'remote.proto (Client)', nodeId: NodeIdService.generateGrpcReferenceId(projectPath, path.join(dir, 'Protos', 'remote.proto')), hasChildren: false, contextValue: 'url' },
    ];

    test('without a Connected Services folder on disk, the project starts with a Connected Services node listing them', async () => {
        const children = await (await newProject()).getRootChildren();
        expect(children[0]).toEqual({ type: 'connectedServices', name: 'Connected Services', nodeId: NodeIdService.generateConnectedServicesId(projectPath), hasChildren: true });
        expect(children.filter(child => child.name === 'Connected Services')).toHaveLength(1);
        expect(grpcChildren(NodeIdService.parse(children[0].nodeId))).toEqual(expectedReferences());
    });

    test('with the folder (service references), the folder lists the gRPC references after its own folders', async () => {
        const folder = path.join(dir, 'Connected Services');
        fs.mkdirSync(path.join(folder, 'Billing'), { recursive: true });
        fs.writeFileSync(path.join(folder, 'Billing', 'ConnectedService.json'), '{}');
        const project = await newProject();
        const children = await project.getRootChildren();
        expect(children.some(child => child.type === 'connectedServices')).toBe(false);
        const connected = children.find(child => child.name === 'Connected Services')!;
        expect(connected).toEqual(expect.objectContaining({ type: 'folder', contextValue: 'connectedServices', hasChildren: true }));
        const inside = await project.getFolderChildren(folder);
        expect(inside.map(child => child.name)).toEqual(['Billing', 'greet.proto (Both)', 'remote.proto (Client)']);
        expect(inside.slice(1)).toEqual(expectedReferences());
    });

    test('an empty Connected Services folder still opens to the gRPC references', async () => {
        fs.mkdirSync(path.join(dir, 'Connected Services'));
        const children = await (await newProject()).getRootChildren();
        expect(children.find(child => child.name === 'Connected Services')).toEqual(expect.objectContaining({ type: 'folder', hasChildren: true }));
    });

    test('no gRPC references: no Connected Services node; other nodes have no gRPC children', async () => {
        (ProjectItemsService.instance.get as jest.Mock).mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }] },
        }), dir));
        const children = await (await newProject()).getRootChildren();
        expect(children.some(child => child.name === 'Connected Services')).toBe(false);
        expect(grpcChildren(NodeIdService.parse(NodeIdService.generateFolderId(dir)))).toBeUndefined();
    });
});
