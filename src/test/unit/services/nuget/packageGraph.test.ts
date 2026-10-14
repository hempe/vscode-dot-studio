import { collectTransitivePackages, packageDependencies, parsePackageGraph, transitiveReferrers } from '../../../../services/nuget/packageGraph';

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
    });
});
