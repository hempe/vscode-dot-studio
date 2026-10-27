import { efArgs, efStartup, migrationNameProblem, parseDbContexts } from '../../../../services/entityFramework/efArgs';

describe('Entity Framework tool arguments', () => {
    const target = { project: '/w/Data/Data.csproj', startupProject: '/w/Web/Web.csproj', context: 'Shop.Data.ShopContext' };

    it('builds the dotnet ef commands with project, startup project and context', () => {
        expect(efArgs('addMigration', target, 'AddOrders')).toEqual([
            'ef', 'migrations', 'add', 'AddOrders', '--project', '/w/Data/Data.csproj', '--startup-project', '/w/Web/Web.csproj', '--context', 'Shop.Data.ShopContext']);
        expect(efArgs('updateDatabase', { project: '/w/Web/Web.csproj' })).toEqual(['ef', 'database', 'update', '--project', '/w/Web/Web.csproj']);
        expect(efArgs('removeMigration', target).slice(0, 3)).toEqual(['ef', 'migrations', 'remove']);
    });

    it('accepts migration names that are class names, nothing else', () => {
        expect(migrationNameProblem('AddOrders_2')).toBeUndefined();
        for (const bad of ['', '  ', '1Orders', 'Add Orders', 'Add-Orders', 'Add.Orders', 'Ärger;']) {
            expect(migrationNameProblem(bad)).toEqual(expect.any(String));
        }
    });

    it('lists the DbContexts and leaves the build messages out', () => {
        expect(parseDbContexts('Build started...\nBuild succeeded.\nShop.Data.ShopContext\nShop.Data.AuditContext\nShop.Data.ShopContext\n')).toEqual(['Shop.Data.ShopContext', 'Shop.Data.AuditContext']);
        expect(parseDbContexts('No DbContext was found in assembly')).toEqual([]);
    });

    it('uses the project itself as startup when it can start, else the solution startup project', () => {
        expect(efStartup('/w/Web.csproj', true, '/w/Other.csproj')).toEqual({ needed: false });
        expect(efStartup('/w/Data.csproj', false, '/w/Web.csproj')).toEqual({ startupProject: '/w/Web.csproj', needed: false });
        expect(efStartup('/w/Data.csproj', false, null)).toEqual({ needed: true });
        expect(efStartup('/w/Data.csproj', false, '/w/Data.csproj')).toEqual({ needed: true });
    });
});
