import * as vscode from 'vscode';
import * as path from 'path';
import { execDotnet } from '../nuget/dotnetCli';
import { SolutionService } from '../solution/solutionService';
import { DebugConfigService } from '../debug/debugConfigService';
import { solutionWorkspaceFolder } from '../solution/workspaceFolders';
import { EfAction, efArgs, efStartup, migrationNameProblem, parseDbContexts } from './efArgs';

/** What the Entity Framework commands need from VS Code and the tool; replaced in tests */
export interface EfDeps {
    hasTool(cwd: string): Promise<boolean>;
    offerToolInstall(): Promise<void>;
    isExecutable(project: string): boolean;
    solutionStartup(): string | null;
    /** The output of `dotnet ef dbcontext list` (it builds the project) */
    listContexts(args: string[], cwd: string): Promise<string>;
    askName(validate: (value: string) => string | undefined): Promise<string | undefined>;
    pick(items: string[], placeHolder: string): Promise<string | undefined>;
    confirm(message: string, button: string): Promise<boolean>;
    run(args: string[], cwd: string, label: string): Promise<void>;
    warn(message: string): void;
}

/** Add Migration, Update Database and Remove Last Migration of a project, with the `dotnet ef` tool in a task */
export async function runEfAction(action: EfAction, project: string, deps: EfDeps = vscodeDeps): Promise<void> {
    const cwd = path.dirname(project);
    const name = path.basename(project, path.extname(project));
    if (!await deps.hasTool(cwd)) {
        await deps.offerToolInstall();
        return;
    }

    const startup = efStartup(project, deps.isExecutable(project), deps.solutionStartup());
    if (startup.needed) {
        deps.warn(`Entity Framework runs the startup project's configuration (connection string, services): ${name} cannot start. Set the project that starts your application as startup project first.`);
        return;
    }
    const base = { project, startupProject: startup.startupProject };

    // The name first: asking which DbContext builds the project, which takes a moment
    let migrationName: string | undefined;
    if (action === 'addMigration') {
        migrationName = await deps.askName(migrationNameProblem);
        if (!migrationName) {
            return;
        }
    }

    const contexts = parseDbContexts(await deps.listContexts(['ef', 'dbcontext', 'list', '--project', project, ...(startup.startupProject ? ['--startup-project', startup.startupProject] : [])], cwd).catch(() => ''));
    let context: string | undefined;
    if (contexts.length > 1) {
        context = await deps.pick(contexts, `Which DbContext of ${name}?`);
        if (!context) {
            return;
        }
    }
    const target = { ...base, context };
    const where = startup.startupProject ? ` with the configuration of ${path.basename(startup.startupProject, path.extname(startup.startupProject))}` : '';

    if (action === 'updateDatabase' && !await deps.confirm(`Apply the pending migrations of ${name} to the database${where}?`, 'Update Database')) {
        return;
    }
    if (action === 'removeMigration' && !await deps.confirm(`Remove the last migration of ${name}? Its files are deleted; this fails when it is already applied to the database.`, 'Remove Migration')) {
        return;
    }
    await deps.run(efArgs(action, target, migrationName), cwd, `${action === 'addMigration' ? `Add Migration ${migrationName}` : action === 'updateDatabase' ? 'Update Database' : 'Remove Migration'} (${name})`);
}

const vscodeDeps: EfDeps = {
    hasTool: cwd => execDotnet(['ef', '--version'], { cwd, timeout: 30000 }).then(() => true, () => false),
    offerToolInstall: async () => {
        const answer = await vscode.window.showErrorMessage('The dotnet-ef tool is not installed (a global tool, or a local one in a tool manifest).', 'Install dotnet-ef');
        if (answer === 'Install dotnet-ef') {
            await vscode.tasks.executeTask(new vscode.Task({ type: 'shinobi-dotnet-ef' }, solutionWorkspaceFolder() ?? vscode.TaskScope.Workspace,
                'Install dotnet-ef', 'shinobi-dotnet', new vscode.ProcessExecution('dotnet', ['tool', 'install', '--global', 'dotnet-ef'])));
        }
    },
    isExecutable: project => SolutionService.getActiveSolution()?.getProject(project)?.isExecutable ?? false,
    solutionStartup: () => DebugConfigService.getStartupProject(),
    listContexts: (args, cwd) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Looking for DbContexts...' },
        () => execDotnet(args, { cwd, timeout: 180000 }).then(result => result.stdout))),
    askName: validate => Promise.resolve(vscode.window.showInputBox({ prompt: 'Name of the migration', placeHolder: 'AddCustomerTable', validateInput: validate })),
    pick: (items, placeHolder) => Promise.resolve(vscode.window.showQuickPick(items, { placeHolder })),
    confirm: async (message, button) => (await vscode.window.showWarningMessage(message, { modal: true }, button)) === button,
    run: async (args, cwd, label) => {
        await vscode.tasks.executeTask(new vscode.Task({ type: 'shinobi-dotnet-ef' }, solutionWorkspaceFolder() ?? vscode.TaskScope.Workspace,
            label, 'shinobi-dotnet', new vscode.ProcessExecution('dotnet', args, { cwd }), '$msCompile'));
    },
    warn: message => { void vscode.window.showWarningMessage(message); },
};
