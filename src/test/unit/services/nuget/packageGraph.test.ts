import { collectTransitivePackages, dependencyPaths, packageDependencies, parsePackageGraph, parsePackageGraphs, targetNameOfAlias, transitiveReferrers } from '../../../../services/nuget/packageGraph';

const assets = (targets: Record<string, Record<string, unknown>>, direct: Record<string, string[]>) => JSON.stringify({
    targets,
    project: {
        frameworks: Object.fromEntries(Object.entries(direct).map(([framework, ids]) =>
            [framework, { targetAlias: framework, dependencies: Object.fromEntries(ids.map(id => [id, { target: 'Package' }])) }])),
    },
});

const sqlite = {
    'Microsoft.EntityFrameworkCore.Sqlite/10.0.13': { type: 'package', dependencies: { 'Microsoft.EntityFrameworkCore.Sqlite.Core': '10.0.13', 'SQLitePCLRaw.bundle_e_sqlite3': '2.1.13' } },
    'Microsoft.EntityFrameworkCore.Sqlite.Core/10.0.13': { type: 'package', dependencies: { 'Microsoft.Data.Sqlite.Core': '10.0.13', 'Microsoft.EntityFrameworkCore.Relational': '10.0.13' } },
    'Microsoft.Data.Sqlite.Core/10.0.13': { type: 'package', dependencies: { 'SQLitePCLRaw.core': '2.1.13' } },
    'Microsoft.EntityFrameworkCore.Relational/10.0.13': { type: 'package', dependencies: { 'Microsoft.EntityFrameworkCore': '10.0.13' } },
    'Microsoft.EntityFrameworkCore/10.0.13': { type: 'package' },
    'SQLitePCLRaw.bundle_e_sqlite3/2.1.13': { type: 'package', dependencies: { 'SQLitePCLRaw.core': '2.1.10' } },
    // The version NuGet picked, not the one asked for
    'SQLitePCLRaw.core/2.1.13': { type: 'package' },
    'Shop.Core/1.0.0': { type: 'project', dependencies: { 'Riok.Mapperly': '4.3.1' } },
};

describe('packageGraph', () => {
    const graph = parsePackageGraph(assets({ 'net10.0': sqlite }, { 'net10.0': ['Microsoft.EntityFrameworkCore.Sqlite'] }))!;

    it('lists the packages a package depends on, with the versions NuGet resolved', () => {
        expect(packageDependencies(graph, 'Microsoft.EntityFrameworkCore.Sqlite')).toEqual([
            { id: 'Microsoft.EntityFrameworkCore.Sqlite.Core', version: '10.0.13' },
            { id: 'SQLitePCLRaw.bundle_e_sqlite3', version: '2.1.13' },
        ]);
        expect(packageDependencies(graph, 'sqlitepclraw.bundle_e_sqlite3')).toEqual([{ id: 'SQLitePCLRaw.core', version: '2.1.13' }]);
        expect(packageDependencies(graph, 'Microsoft.EntityFrameworkCore')).toEqual([]);
        expect(packageDependencies(graph, 'Unknown')).toEqual([]);
    });

    it('knows the direct references and which of them bring in each transitive package', () => {
        expect(graph.direct).toEqual(['Microsoft.EntityFrameworkCore.Sqlite']);
        const referrers = transitiveReferrers(graph);
        expect(referrers.get('microsoft.entityframeworkcore')).toEqual(['Microsoft.EntityFrameworkCore.Sqlite']);
        expect(referrers.get('sqlitepclraw.core')).toEqual(['Microsoft.EntityFrameworkCore.Sqlite']);
        expect(referrers.has('microsoft.entityframeworkcore.sqlite')).toBe(false);
        // Projects are not packages
        expect(referrers.has('shop.core')).toBe(false);
    });

    it('uses the requested framework of multi-targeted projects, and leaves out runtime-specific graphs', () => {
        const multi = assets({
            'net8.0': { 'A/1.0.0': { type: 'package', dependencies: { B: '1.0.0' } }, 'B/1.0.0': { type: 'package' } },
            'net10.0': { 'A/2.0.0': { type: 'package' } },
            'net10.0/linux-x64': { 'A/2.0.0': { type: 'package' }, 'runtime.linux/1.0.0': { type: 'package' } },
        }, { 'net8.0': ['A'], 'net10.0': ['A'] });

        expect(packageDependencies(parsePackageGraph(multi, 'net8.0')!, 'A')).toEqual([{ id: 'B', version: '1.0.0' }]);
        expect(packageDependencies(parsePackageGraph(multi, 'net10.0')!, 'A')).toEqual([]);
        // Without a framework: the first one
        expect(parsePackageGraph(multi)!.framework).toBe('net8.0');
    });

    it('finds the target of an old framework by its long name, whatever order the targets come in', () => {
        // As NuGet writes a project that targets net471 and net10.0: the frameworks net10.0 first, the targets .NETFramework first
        const json = JSON.stringify({
            targets: {
                '.NETFramework,Version=v4.7.1': { 'Old/1.0.0': { type: 'package' } },
                'net10.0': { 'New/2.0.0': { type: 'package' } },
            },
            project: { frameworks: { 'net10.0': { dependencies: { New: {} } }, net471: { dependencies: { Old: {} } } } },
        });
        expect([...parsePackageGraph(json, 'net471')!.packages.keys()]).toEqual(['old']);
        expect([...parsePackageGraph(json, 'net10.0')!.packages.keys()]).toEqual(['new']);
        expect(parsePackageGraphs(json).map(graph => [graph.framework, [...graph.packages.keys()]])).toEqual([['net10.0', ['new']], ['net471', ['old']]]);
    });

    it('names the long target of an alias', () => {
        expect(targetNameOfAlias('net471')).toBe('.NETFramework,Version=v4.7.1');
        expect(targetNameOfAlias('net48')).toBe('.NETFramework,Version=v4.8');
        expect(targetNameOfAlias('netstandard2.0')).toBe('.NETStandard,Version=v2.0');
        expect(targetNameOfAlias('netcoreapp3.1')).toBe('.NETCoreApp,Version=v3.1');
        expect(targetNameOfAlias('net10.0')).toBeUndefined();
    });

    it('has no graph for unreadable assets', () => {
        expect(parsePackageGraph('{}')).toBeUndefined();
        expect(parsePackageGraph('not json')).toBeUndefined();
    });

    describe('collectTransitivePackages (the NuGet manager\'s "Transitive packages")', () => {
        const web = { name: 'Web', path: '/repo/Web/Web.csproj' };
        const api = { name: 'Api', path: '/repo/Api/Api.csproj' };
        const apiGraph = parsePackageGraph(assets({
            'net10.0': {
                'Microsoft.EntityFrameworkCore.Relational/10.0.13': { type: 'package', dependencies: { 'Microsoft.EntityFrameworkCore': '10.0.13' } },
                'Microsoft.EntityFrameworkCore/10.0.13': { type: 'package' },
                'SQLitePCLRaw.core/2.1.13': { type: 'package' },
            },
        }, { 'net10.0': ['Microsoft.EntityFrameworkCore.Relational', 'SQLitePCLRaw.core'] }))!;

        it('lists every package that a project only gets through others, with what brings it in', () => {
            const transitive = collectTransitivePackages([{ project: web, graph }]);
            expect(transitive.map(pkg => [pkg.id, pkg.currentVersion, pkg.transitiveReferencedBy])).toEqual([
                ['Microsoft.Data.Sqlite.Core', '10.0.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
                ['Microsoft.EntityFrameworkCore', '10.0.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
                ['Microsoft.EntityFrameworkCore.Relational', '10.0.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
                ['Microsoft.EntityFrameworkCore.Sqlite.Core', '10.0.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
                ['SQLitePCLRaw.bundle_e_sqlite3', '2.1.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
                ['SQLitePCLRaw.core', '2.1.13', ['Microsoft.EntityFrameworkCore.Sqlite']],
            ]);
            expect(transitive[0].projects).toEqual([web]);
        });

        it('merges the projects of a solution and names the project when several bring a package in', () => {
            const transitive = collectTransitivePackages([{ project: web, graph }, { project: api, graph: apiGraph }]);
            const ef = transitive.find(pkg => pkg.id === 'Microsoft.EntityFrameworkCore')!;
            expect(ef.projects).toEqual([web, api]);
            expect(ef.transitiveReferencedBy).toEqual(['Microsoft.EntityFrameworkCore.Sqlite (Web)', 'Microsoft.EntityFrameworkCore.Relational (Api)']);
            // Api references these itself: they are top-level packages there, not transitive ones
            expect(transitive.map(pkg => pkg.id)).not.toContain('Microsoft.EntityFrameworkCore.Relational');
            expect(transitive.map(pkg => pkg.id)).not.toContain('SQLitePCLRaw.core');
        });

        it('names every version restore resolved, not only the highest (an older one may be the vulnerable one)', () => {
            const older = parsePackageGraph(assets({
                'net10.0': {
                    'Microsoft.EntityFrameworkCore.Relational/9.0.1': { type: 'package', dependencies: { 'Microsoft.EntityFrameworkCore': '9.0.1' } },
                    'Microsoft.EntityFrameworkCore/9.0.1': { type: 'package' },
                },
            }, { 'net10.0': ['Microsoft.EntityFrameworkCore.Relational'] }))!;
            const consumer = parsePackageGraph(assets({
                'net10.0': {
                    'Some.Lib/1.0.0': { type: 'package', dependencies: { 'Microsoft.EntityFrameworkCore': '9.0.1' } },
                    'Microsoft.EntityFrameworkCore/9.0.1': { type: 'package' },
                },
            }, { 'net10.0': ['Some.Lib'] }))!;
            const transitive = collectTransitivePackages([{ project: web, graph }, { project: api, graph: consumer }]);
            const ef = transitive.find(pkg => pkg.id === 'Microsoft.EntityFrameworkCore')!;
            expect(ef.currentVersion).toBe('10.0.13');
            expect([...ef.versionsInUse].sort()).toEqual(['10.0.13', '9.0.1']);
            expect(older).toBeDefined();
        });

        describe('as Acme.Core has them: several frameworks and project references', () => {
            // Localisation targets net471 and net10.0: Microsoft.Data.SqlClient (and so Pkcs) only exists for net10.0
            const multi = assets({
                net471: {
                    'Some.Lib/1.0.0': { type: 'package' },
                    'System.Text.Encodings.Web/4.5.0': { type: 'package' },
                    'Acme.Core/1.0.0': { type: 'project', dependencies: { 'System.Text.Encodings.Web': '4.5.0' } },
                },
                'net10.0': {
                    'Some.Lib/1.0.0': { type: 'package' },
                    'Microsoft.Data.SqlClient/6.1.4': { type: 'package', dependencies: { 'System.Security.Cryptography.Pkcs': '9.0.11' } },
                    'System.Security.Cryptography.Pkcs/9.0.11': { type: 'package' },
                    'Acme.Core/1.0.0': { type: 'project', dependencies: { 'Newtonsoft.Json': '13.0.3' } },
                    'Newtonsoft.Json/13.0.3': { type: 'package' },
                },
            }, { net471: ['Some.Lib'], 'net10.0': ['Some.Lib', 'Microsoft.Data.SqlClient'] });
            const lib = { name: 'Localisation', path: '/repo/Localisation/Localisation.csproj' };

            it('parses the graph of every framework', () => {
                expect(parsePackageGraphs(multi).map(graph => graph.framework)).toEqual(['net471', 'net10.0']);
                expect(parsePackageGraphs('not json')).toEqual([]);
            });

            it('a package that exists for one framework only is transitive, with its referrer', () => {
                const transitive = collectTransitivePackages(parsePackageGraphs(multi).map(graph => ({ project: lib, graph })));
                const pkcs = transitive.find(pkg => pkg.id === 'System.Security.Cryptography.Pkcs')!;
                expect(pkcs.currentVersion).toBe('9.0.11');
                expect(pkcs.transitiveReferencedBy).toEqual(['Microsoft.Data.SqlClient']);
                expect(pkcs.projects).toEqual([lib]);
            });

            it('a package that only a referenced project brings in is transitive, referenced by that project', () => {
                const transitive = collectTransitivePackages(parsePackageGraphs(multi).map(graph => ({ project: lib, graph })));
                expect(transitive.map(pkg => [pkg.id, pkg.transitiveReferencedBy])).toEqual(expect.arrayContaining([
                    ['System.Text.Encodings.Web', ['Acme.Core (project)']],
                    ['Newtonsoft.Json', ['Acme.Core (project)']],
                ]));
                // Referenced by the project itself: top-level, never transitive
                expect(transitive.map(pkg => pkg.id)).not.toContain('Some.Lib');
            });

            it('another version of a package some project references itself still counts where it comes in through others', () => {
                const direct = parsePackageGraph(assets({ 'net10.0': {
                    'System.Security.Cryptography.Pkcs/10.0.14': { type: 'package' },
                } }, { 'net10.0': ['System.Security.Cryptography.Pkcs'] }))!;
                const sameVersion = parsePackageGraph(assets({ 'net10.0': {
                    'Microsoft.Data.SqlClient/6.1.4': { type: 'package', dependencies: { 'System.Security.Cryptography.Pkcs': '10.0.14' } },
                    'System.Security.Cryptography.Pkcs/10.0.14': { type: 'package' },
                } }, { 'net10.0': ['Microsoft.Data.SqlClient'] }))!;
                const older = parsePackageGraph(assets({ 'net10.0': {
                    'Microsoft.Data.SqlClient/6.1.4': { type: 'package', dependencies: { 'System.Security.Cryptography.Pkcs': '9.0.11' } },
                    'System.Security.Cryptography.Pkcs/9.0.11': { type: 'package' },
                } }, { 'net10.0': ['Microsoft.Data.SqlClient'] }))!;
                const a = { name: 'A', path: '/a.csproj' };
                const b = { name: 'B', path: '/b.csproj' };
                const c = { name: 'C', path: '/c.csproj' };

                const transitive = collectTransitivePackages([{ project: a, graph: direct }, { project: b, graph: sameVersion }, { project: c, graph: older }]);
                const pkcs = transitive.find(pkg => pkg.id === 'System.Security.Cryptography.Pkcs')!;

                // B gets the very version A references: nothing to add. C gets 9.0.11, which no list showed before.
                expect(pkcs.versionsInUse).toEqual(['9.0.11']);
                expect(pkcs.projects).toEqual([c]);
                expect(pkcs.projectVersions).toEqual({ '/c.csproj': ['9.0.11'] });
                expect(pkcs.transitiveReferencedBy).toEqual(['Microsoft.Data.SqlClient (C)']);
            });

            it('names a referrer once, however many frameworks bring it in', () => {
                const twice = assets({
                    net471: { 'A/1.0.0': { type: 'package', dependencies: { B: '1.0.0' } }, 'B/1.0.0': { type: 'package' } },
                    'net10.0': { 'A/1.0.0': { type: 'package', dependencies: { B: '1.0.0' } }, 'B/1.0.0': { type: 'package' } },
                }, { net471: ['A'], 'net10.0': ['A'] });
                const [b] = collectTransitivePackages(parsePackageGraphs(twice).map(graph => ({ project: lib, graph })));
                expect(b.transitiveReferencedBy).toEqual(['A']);
                expect(b.projects).toEqual([lib]);
            });
        });
    });

describe('dependencyPaths (how a project gets a package)', () => {
    const assetsWith = (target: Record<string, unknown>, direct: string[]) => parsePackageGraph(assets({ 'net10.0': target }, { 'net10.0': direct }))!;

    it('names every hop from a package the project references down to the package', () => {
        const graph = assetsWith({
            'Microsoft.Data.SqlClient/6.1.4': { type: 'package', dependencies: { 'Azure.Identity': '1.0.0' } },
            'Azure.Identity/1.0.0': { type: 'package', dependencies: { 'System.Security.Cryptography.Pkcs': '9.0.11' } },
            'System.Security.Cryptography.Pkcs/9.0.11': { type: 'package' },
        }, ['Microsoft.Data.SqlClient']);
        expect(dependencyPaths(graph, 'system.security.cryptography.pkcs')).toEqual([
            { framework: 'net10.0', hops: ['Microsoft.Data.SqlClient 6.1.4', 'Azure.Identity 1.0.0', 'System.Security.Cryptography.Pkcs 9.0.11'] },
        ]);
    });

    it('starts at a referenced project when that is what brings the package in', () => {
        const graph = assetsWith({
            'Acme.Core.Localisation/1.0.0': { type: 'project', dependencies: { 'Microsoft.Data.SqlClient': '6.1.4' } },
            'Microsoft.Data.SqlClient/6.1.4': { type: 'package', dependencies: { 'System.Security.Cryptography.Pkcs': '9.0.11' } },
            'System.Security.Cryptography.Pkcs/9.0.11': { type: 'package' },
        }, []);
        expect(dependencyPaths(graph, 'System.Security.Cryptography.Pkcs').map(path => path.hops)).toEqual([
            ['Acme.Core.Localisation (project)', 'Microsoft.Data.SqlClient 6.1.4', 'System.Security.Cryptography.Pkcs 9.0.11'],
        ]);
    });

    it('lists the shortest ways first, no more than the limit, and none for a package the project does not have', () => {
        const graph = assetsWith({
            'A/1.0.0': { type: 'package', dependencies: { Target: '1.0.0', B: '1.0.0' } },
            'B/1.0.0': { type: 'package', dependencies: { Target: '1.0.0' } },
            'C/1.0.0': { type: 'package', dependencies: { Target: '1.0.0' } },
            'Target/1.0.0': { type: 'package' },
        }, ['A', 'C']);
        const paths = dependencyPaths(graph, 'Target', 2).map(path => path.hops);
        expect(paths).toHaveLength(2);
        expect(paths.every(hops => hops.length === 2)).toBe(true);
        expect(dependencyPaths(graph, 'Target').map(path => path.hops.length)).toEqual([2, 2, 3]);
        expect(dependencyPaths(graph, 'Missing')).toEqual([]);
    });

    it('survives a cycle', () => {
        const graph = assetsWith({
            'A/1.0.0': { type: 'package', dependencies: { B: '1.0.0' } },
            'B/1.0.0': { type: 'package', dependencies: { A: '1.0.0', Target: '1.0.0' } },
            'Target/1.0.0': { type: 'package' },
        }, ['A']);
        expect(dependencyPaths(graph, 'Target').map(path => path.hops)).toEqual([['A 1.0.0', 'B 1.0.0', 'Target 1.0.0']]);
    });
});
});
