import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { DebugConfigService } from '../debugConfigService';
import { activeProjectBuild } from '../activeBuild';
import { platformProperty } from '../configurationManager/configurationManager';
import { checkDevCertificateBeforeStart } from '../devCert/devCertCheck';
import { SolutionService } from '../solutionService';
import { UnloadedProjects } from '../unloadedProjects';
import { hotReloadArgs, hotReloadTerminalName } from './hotReloadCommand';
import { isNetFrameworkTarget } from '../../parsers/targetFrameworks';

const log = logger('HotReload');

/** How long a restart waits for the previous `dotnet watch` terminal to close (its app frees the port) */
const CLOSE_TIMEOUT = 5000;

/**
 * "Start with Hot Reload": runs the project with `dotnet watch run` in a terminal named "<project> (watch)", without
 * the debugger. Edits are applied to the running app; edits it cannot apply restart it. Starting it again for the same
 * project restarts it; closing the terminal stops it.
 *
 * No debugger, on purpose: with netcoredbg (the debugger of the open-source C# extension) attached to the app
 * dotnet watch starts, the runtime refuses the update ("Assembly updates cannot be applied while a debugger is
 * attached") and dotnet watch stops applying changes to that process, also after the debugger detaches. Checked with
 * SDK 10.0.111 and netcoredbg 3.2.0-1, see docs/run-and-debug.md.
 *
 * Without a project (command palette) it runs the startup project, or asks for a project that can be started.
 */
export async function startWithHotReload(projectPath?: string): Promise<void> {
    const target = projectPath ?? await pickProject();
    if (!target) {
        return;
    }
    const projectName = path.basename(target, path.extname(target));

    const framework = await DebugConfigService.startFramework(target);
    if (isNetFrameworkTarget(framework)) {
        vscode.window.showWarningMessage(
            `${projectName} targets .NET Framework (${framework}), which dotnet watch cannot hot reload. Use Start Without Debugging instead.`);
        return;
    }

    const profile = DebugConfigService.startLaunchProfile(target);
    checkDevCertificateBeforeStart([profile]);

    const { configuration, platform } = activeProjectBuild(target);
    const args = hotReloadArgs({
        projectPath: target,
        launchProfile: profile?.name,
        configuration,
        framework,
        properties: platformProperty(platform),
    });

    const name = hotReloadTerminalName(target);
    await closeTerminals(name);
    log.info(`Starting ${projectName} with Hot Reload: dotnet ${args.join(' ')}`);
    const terminal = vscode.window.createTerminal({
        name,
        shellPath: 'dotnet',
        shellArgs: args,
        cwd: path.dirname(target),
        iconPath: new vscode.ThemeIcon('flame'),
    });
    terminal.show();
}

/** Closes the terminals of a previous run and waits (bounded) until they are gone */
async function closeTerminals(name: string): Promise<void> {
    const previous = vscode.window.terminals.filter(terminal => terminal.name === name);
    if (previous.length === 0) {
        return;
    }
    const open = new Set<vscode.Terminal>(previous);
    await new Promise<void>(resolve => {
        const timer = setTimeout(done, CLOSE_TIMEOUT);
        const listener = vscode.window.onDidCloseTerminal(terminal => {
            open.delete(terminal);
            if (open.size === 0) {
                done();
            }
        });
        function done() {
            clearTimeout(timer);
            listener.dispose();
            resolve();
        }
        previous.forEach(terminal => terminal.dispose());
    });
}

/** The startup project, else the user's choice among the loaded projects that can be started */
async function pickProject(): Promise<string | undefined> {
    const startup = DebugConfigService.getStartupProject();
    if (startup) {
        return startup;
    }
    const solution = SolutionService.getActiveSolution();
    const projects = solution
        ? Array.from(solution.projects.values())
            .filter(project => project.isExecutable && !UnloadedProjects.isUnloaded(solution.solutionPath, project.projectPath))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];
    if (projects.length === 0) {
        vscode.window.showInformationMessage('There is no project to start. Open a solution with a project that can be started.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(
        projects.map(project => ({ label: project.name, description: path.dirname(project.projectPath), projectPath: project.projectPath })),
        { placeHolder: 'Project to start with Hot Reload' });
    return picked?.projectPath;
}
