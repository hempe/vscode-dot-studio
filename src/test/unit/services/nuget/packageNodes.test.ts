import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

const env = { projectPath: '', directChildren: [] as any[] };
jest.mock('../../../../services/solution/solutionService', () => ({
    SolutionService: {
        getActiveSolution: () => ({
            getActiveFramework: () => null,
            getProject: () => ({ frameworks: ['net10.0'], getDependenciesByCategory: () => env.directChildren }),
        }),
    },
}));

import { packageChildren } from '../../../../services/nuget/packageNodes';
import { NodeIdService } from '../../../../services/solution/nodeIdService';

describe('packageChildren (packages under Dependencies expand like Visual Studio)', () => {
    let root: string;

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'package-nodes-')));
        env.projectPath = path.join(root, 'Web.csproj');
        fs.mkdirSync(path.join(root, 'obj'));
        fs.writeFileSync(path.join(root, 'obj', 'project.assets.json'), JSON.stringify({
            targets: {
                'net10.0': {
                    'Microsoft.EntityFrameworkCore.Sqlite/10.0.13': { type: 'package', dependencies: { 'Microsoft.Data.Sqlite.Core': '10.0.13', 'SQLitePCLRaw.core': '2.1.13' } },
                    'Microsoft.Data.Sqlite.Core/10.0.13': { type: 'package', dependencies: { 'SQLitePCLRaw.core': '2.1.13' } },
                    'SQLitePCLRaw.core/2.1.13': { type: 'package' },
                    'Riok.Mapperly/4.3.1': { type: 'package' },
                },
            },
            project: { frameworks: { 'net10.0': { dependencies: { 'Microsoft.EntityFrameworkCore.Sqlite': {}, 'Riok.Mapperly': {} } } } },
        }));
        env.directChildren = ['Microsoft.EntityFrameworkCore.Sqlite', 'Riok.Mapperly'].map(name => ({
            type: 'dependency',
            name,
            nodeId: NodeIdService.generateDependencyId(env.projectPath, 'packages', name, undefined),
            hasChildren: false,
        }));
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const names = (children: any[] | undefined) => children?.map(child => `${child.name}${child.hasChildren ? ' ▸' : ''}`);

    it('marks the packages that have dependencies as expandable', () => {
        const packages = packageChildren(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(env.projectPath, 'packages')));
        expect(names(packages)).toEqual(['Microsoft.EntityFrameworkCore.Sqlite ▸', 'Riok.Mapperly']);
    });

    it('expands a package to its dependencies, and those further, with resolved versions', () => {
        const sqlite = packageChildren(NodeIdService.parse(env.directChildren[0].nodeId))!;
        expect(names(sqlite)).toEqual(['Microsoft.Data.Sqlite.Core (10.0.13) ▸', 'SQLitePCLRaw.core (2.1.13)']);
        expect(sqlite.map(child => child.type)).toEqual(['transitivePackage', 'transitivePackage']);

        const core = packageChildren(NodeIdService.parse(sqlite[0].nodeId))!;
        expect(names(core)).toEqual(['SQLitePCLRaw.core (2.1.13)']);
        // The same package under another parent is another node
        expect(core[0].nodeId).not.toBe(sqlite[1].nodeId);
    });

    it('leaves other nodes alone', () => {
        expect(packageChildren(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(env.projectPath, 'projects')))).toBeUndefined();
        expect(packageChildren(NodeIdService.parse(NodeIdService.generateFolderId(root)))).toBeUndefined();
    });

    it('has nothing to expand before the first restore', () => {
        fs.rmSync(path.join(root, 'obj'), { recursive: true });
        const packages = packageChildren(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(env.projectPath, 'packages')));
        expect(names(packages)).toEqual(['Microsoft.EntityFrameworkCore.Sqlite', 'Riok.Mapperly']);
    });
});
