jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/debug/debugConfigService', () => ({ DebugConfigService: { getStartupProject: () => null } }));
jest.mock('../../../../services/solution/workspaceFolders', () => ({ solutionWorkspaceFolder: () => undefined }));

import { EfDeps, runEfAction } from '../../../../services/entityFramework/efCommands';

const calls: string[] = [];
const deps = (overrides: Partial<EfDeps> = {}): EfDeps => ({
    hasTool: async () => true,
    offerToolInstall: async () => { calls.push('offerInstall'); },
    isExecutable: project => project.endsWith('Web.csproj'),
    solutionStartup: () => '/w/Web/Web.csproj',
    listContexts: async () => 'Build succeeded.\nShop.ShopContext\n',
    askName: async () => 'AddOrders',
    pick: async items => items[1],
    confirm: async () => true,
    run: async (args, cwd, label) => { calls.push(`run ${label} in ${cwd}: ${args.join(' ')}`); },
    warn: message => { calls.push(`warn ${message}`); },
    ...overrides,
});
beforeEach(() => { calls.length = 0; });

describe('runEfAction', () => {
    it('offers to install dotnet-ef when the tool is missing and runs nothing', async () => {
        await runEfAction('addMigration', '/w/Data/Data.csproj', deps({ hasTool: async () => false }));
        expect(calls).toEqual(['offerInstall']);
    });

    it('adds a migration in a library with the solution startup project', async () => {
        await runEfAction('addMigration', '/w/Data/Data.csproj', deps());
        expect(calls).toEqual(['run Add Migration AddOrders (Data) in /w/Data: ef migrations add AddOrders --project /w/Data/Data.csproj --startup-project /w/Web/Web.csproj']);
    });

    it('uses a project that can start as its own startup project', async () => {
        await runEfAction('updateDatabase', '/w/Web/Web.csproj', deps());
        expect(calls).toEqual(['run Update Database (Web) in /w/Web: ef database update --project /w/Web/Web.csproj']);
    });

    it('asks which DbContext when there are several, and stops when none is picked', async () => {
        const several = deps({ listContexts: async () => 'Shop.ShopContext\nShop.AuditContext\n' });
        await runEfAction('addMigration', '/w/Data/Data.csproj', several);
        expect(calls[0]).toContain('--context Shop.AuditContext');

        calls.length = 0;
        await runEfAction('addMigration', '/w/Data/Data.csproj', { ...several, pick: async () => undefined });
        expect(calls).toEqual([]);
    });

    it('goes on without a context when listing them fails', async () => {
        await runEfAction('removeMigration', '/w/Web/Web.csproj', deps({ listContexts: async () => { throw new Error('build failed'); } }));
        expect(calls).toEqual(['run Remove Migration (Web) in /w/Web: ef migrations remove --project /w/Web/Web.csproj']);
    });

    it('asks before changing the database or removing a migration, and does nothing when declined', async () => {
        const asked: string[] = [];
        const declining = deps({ confirm: async message => { asked.push(message); return false; } });
        await runEfAction('updateDatabase', '/w/Web/Web.csproj', declining);
        await runEfAction('removeMigration', '/w/Web/Web.csproj', declining);
        expect(calls).toEqual([]);
        expect(asked[0]).toContain('Apply the pending migrations of Web');
        expect(asked[1]).toContain('Remove the last migration of Web');
    });

    it('says a startup project is needed when the project cannot start and none is set', async () => {
        await runEfAction('updateDatabase', '/w/Data/Data.csproj', deps({ solutionStartup: () => null }));
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatch(/^warn Entity Framework runs the startup project/);
    });

    it('stops when no name is entered', async () => {
        await runEfAction('addMigration', '/w/Web/Web.csproj', deps({ askName: async () => undefined }));
        expect(calls).toEqual([]);
    });
});
