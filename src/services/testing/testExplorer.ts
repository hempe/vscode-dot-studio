import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { privateTempDir } from '../../core/privateTemp';
import { createHash } from 'crypto';
import { spawn, execFile } from 'child_process';
import { logger } from '../../core/logger';
import { sln } from '../../core/utils';
import { RequestQueue } from '../../core/requestQueue';
import { SolutionService } from '../solution/solutionService';
import { BuildConfiguration } from '../build/buildConfiguration';
import { DOTNET_TASK_TYPE } from '../build/dotnetTaskProvider';
import { EMIT_GENERATED_FILES } from '../diagnostics/analyzers';
import { Settings } from '../shared/settings';
import { connectTestApp, TestApp, TestNode, TestSession } from './testingPlatformClient';
import { buildTestTree, outcomeOf, TreeEntry } from './testTree';
import { evaluateTestProject, isTestProjectCandidate, testFrameworks, projectTextWithBuildProps, testAppCommand, TestProject } from './testProjects';
import { connectVsTest, VsTestCase, vstestCaseNode, vstestResultNode, VsTestSession } from './vstestClient';
import { MONO_DEBUG_UNSUPPORTED, monoVsTestConsole, needsMono } from './monoVsTest';
import { testingPlatformRunSettings, vstestRunSettings } from './runSettings';
import { solutionWorkspaceFolder } from '../solution/workspaceFolders';

const log = logger('TestExplorer');

/** What the Test Explorer needs from the outside; replaced in tests */
export interface TestExplorerDeps {
    /** Project files of the active solution */
    projects(): string[];
    readProject(projectPath: string): string;
    /** The target frameworks of a multi-targeted project; none for a project with one */
    frameworks(projectPath: string): Promise<string[]>;
    /** MSBuild's view of a test project, for `framework` when it is multi-targeted */
    evaluate(projectPath: string, configuration: string, framework?: string): Promise<TestProject | undefined>;
    platform(): NodeJS.Platform;
    /** Builds the project (for one framework of a multi-targeted project); false when the build failed or `signal` stopped it */
    build(projectPath: string, configuration: string, output: (text: string) => void, targetFramework?: string, signal?: AbortSignal): Promise<boolean>;
    /** Starts the test app with the server arguments, in the debugger for debug runs, with extra environment variables */
    start(project: TestProject, args: string[], debug: boolean, environment: Readonly<Record<string, string>>): Promise<TestApp>;
    /** Starts vstest.console in design mode, connecting to the port (VSTest projects) */
    startVsTest(project: TestProject, port: number): Promise<TestApp>;
    /** Attaches the debugger to a test host VSTest started paused; false when it couldn't */
    attachDebugger(project: TestProject, processId: number): Promise<boolean>;
    /** Last write time of the test app, to re-discover only what a build changed */
    modified(file: string): number | undefined;
    /** The content of a run settings file; undefined when it can't be read */
    readRunSettings(file: string): string | undefined;
    /** Whether the Microsoft.Testing.Platform app has the VSTest bridge, which reads run settings (`--settings`) */
    hasVsTestBridge(targetPath: string): boolean;
    /** Writes run settings for `--settings` to a temporary file and gives its path */
    writeRunSettings(content: string): string;
}

function startProcess(project: TestProject, args: string[], environment: Readonly<Record<string, string>>): Promise<TestApp> {
    const start = testAppCommand(project, args);
    const child = spawn(start.command, start.args, {
        cwd: path.dirname(project.projectPath),
        env: { ...process.env, TESTINGPLATFORM_TELEMETRY_OPTOUT: '1', ...environment },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += String(error); });
    return Promise.resolve({ kill: () => { child.kill(); }, output: () => output, onExit: listener => { child.once('exit', listener); } });
}

async function startInDebugger(project: TestProject, args: string[], environment: Readonly<Record<string, string>>): Promise<TestApp> {
    const name = `Debug tests: ${path.parse(project.projectPath).name}`;
    let session: vscode.DebugSession | undefined;
    const listener = vscode.debug.onDidStartDebugSession(started => {
        if (started.name === name) {
            session = started;
        }
    });
    const started = await vscode.debug.startDebugging(solutionWorkspaceFolder(), {
        type: 'coreclr',
        request: 'launch',
        name,
        program: project.targetPath,
        args,
        cwd: path.dirname(project.projectPath),
        env: { TESTINGPLATFORM_TELEMETRY_OPTOUT: '1', ...environment },
        console: 'internalConsole',
    });
    listener.dispose();
    if (!started) {
        throw new Error('The debugger could not be started (is a C# extension installed?).');
    }
    return { kill: () => { void vscode.debug.stopDebugging(session); }, output: () => '' };
}

/**
 * The SDK's vstest.console.dll in design mode; for .NET Framework projects outside Windows the TestPlatform
 * package's vstest.console.exe under Mono instead (see monoVsTest.ts)
 */
async function startVsTestConsole(project: TestProject, port: number): Promise<TestApp> {
    const [command, consolePath] = needsMono(project, process.platform) ? ['mono', await monoVsTestConsole()] : ['dotnet', project.vstestConsolePath!];
    const child = spawn(command, [consolePath, `--port:${port}`, `--parentprocessid:${process.pid}`], {
        cwd: path.dirname(project.projectPath),
        env: { ...process.env, VSTEST_TELEMETRY_OPTEDIN: '0' },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += String(error); });
    return { kill: () => { child.kill(); }, output: () => output, onExit: listener => { child.once('exit', listener); } };
}

async function attachToTestHost(project: TestProject, processId: number): Promise<boolean> {
    return vscode.debug.startDebugging(solutionWorkspaceFolder(), {
        type: 'coreclr',
        request: 'attach',
        name: `Debug tests: ${path.parse(project.projectPath).name}`,
        processId,
    });
}

const defaultDeps: TestExplorerDeps = {
    projects: () => [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])],
    readProject: projectPath => projectTextWithBuildProps(projectPath),
    frameworks: testFrameworks,
    evaluate: evaluateTestProject,
    platform: () => process.platform,
    build: (projectPath, configuration, output, targetFramework, signal) => new Promise(resolve => {
        execFile('dotnet', ['build', projectPath, '--configuration', configuration, ...(targetFramework ? ['--framework', targetFramework] : []), '-nologo', '-consoleLoggerParameters:NoSummary', ...(Settings.emitGeneratedFiles() ? [EMIT_GENERATED_FILES] : [])],
            // maxBuffer: thousands of warnings are more than the 1 MiB default, which would kill the build and report it as failed
            { cwd: path.dirname(projectPath), timeout: 600000, maxBuffer: 256 * 1024 * 1024, signal }, (error, stdout, stderr) => {
                output(`${stdout}${stderr}`);
                resolve(!error);
            });
    }),
    start: (project, args, debug, environment) => debug ? startInDebugger(project, args, environment) : startProcess(project, args, environment),
    startVsTest: startVsTestConsole,
    attachDebugger: attachToTestHost,
    modified: file => {
        try {
            return fs.statSync(file).mtimeMs;
        } catch {
            return undefined;
        }
    },
    readRunSettings: file => {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    },
    hasVsTestBridge: targetPath => fs.existsSync(path.join(path.dirname(targetPath), 'Microsoft.Testing.Extensions.VSTestBridge.dll')),
    writeRunSettings: content => {
        // One file per content: concurrent runs of projects with different settings don't overwrite each other
        const folder = privateTempDir('runsettings');
        // The temp folder is not emptied on Windows: files of earlier sessions go
        for (const name of fs.readdirSync(folder)) {
            try {
                if (Date.now() - fs.statSync(path.join(folder, name)).mtimeMs > 24 * 3600 * 1000) {
                    fs.rmSync(path.join(folder, name), { force: true });
                }
            } catch { /* in use or gone */ }
        }
        const file = path.join(folder, `${createHash('sha256').update(content).digest('hex').slice(0, 16)}.runsettings`);
        fs.writeFileSync(file, content, 'utf8');
        return file;
    },
};

/** Test projects processed at once when refreshing, so a solution with many doesn't start dozens of dotnet processes */
const dotnetQueue = new RequestQueue(4);

/** The first error lines of a build's output ("Build failed: x.cs(1,1): error CS1002: ; expected"), which no Problems panel shows for MSBuild and NuGet errors */
export function buildFailure(output: string): string {
    const errors = output.split(/\r?\n/).filter(line => /:\s*error\s+\w+:/i.test(line)).map(line => line.trim());
    return errors.length > 0 ? `Build failed:\n${[...new Set(errors)].slice(0, 3).join('\n')}` : 'Build failed';
}

const terminal = (text: string) => text.replace(/\r?\n/g, '\r\n');

/** The description of a test project item whose test app isn't built: nothing to discover yet */
export const NOT_BUILT = 'not built yet: Run or refresh builds it';

/** One test item per project, and per target framework when the project has several */
const stateKey = (project: TestProject) => project.targetFramework ? `${project.projectPath}|${project.targetFramework}` : project.projectPath;

interface ProjectState {
    project: TestProject;
    item: vscode.TestItem;
    discoveredAt?: number;
}

/** A project in a run: its tests to run, or undefined for all of them */
interface ProjectRun {
    readonly state: ProjectState;
    readonly items: vscode.TestItem[] | undefined;
}

/** The ".NET Tests" controller: the tests of the active solution in the Test Explorer, Microsoft.Testing.Platform and VSTest projects */
export class TestExplorer implements vscode.Disposable {
    readonly controller: vscode.TestController;
    private readonly deps: TestExplorerDeps;
    private readonly states = new Map<string, ProjectState>();
    private readonly nodes = new Map<vscode.TestItem, TestNode>();
    /** VSTest's own test cases by uid: running selected tests passes them back */
    private readonly vstestCases = new Map<string, VsTestCase>();
    private readonly disposables: vscode.Disposable[] = [];
    private refreshing: Promise<void> | undefined;

    constructor(deps: Partial<TestExplorerDeps> = {}) {
        this.deps = { ...defaultDeps, ...deps };
        this.controller = vscode.tests.createTestController('shinobi-dotnet-tests', '.NET Tests');
        this.controller.resolveHandler = async item => {
            if (!item) {
                await this.refresh(false);
            }
        };
        this.controller.refreshHandler = () => this.refresh(true);
        this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token, false), true);
        this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.run(request, token, true), true);

        this.disposables.push(
            this.controller,
            // A build (Ctrl+Shift+B, the context menu, F5's pre-build) may have changed tests
            vscode.tasks.onDidEndTaskProcess(event => {
                const task = event.execution.task;
                const isBuild = (task.definition.type === DOTNET_TASK_TYPE && ['build', 'rebuild'].includes(task.definition.action))
                    || task.name === 'StartupPreBuild';
                if (isBuild && event.exitCode === 0 && Settings.discoverTestsAfterBuild()) {
                    void this.refresh(false);
                }
            }),
            BuildConfiguration.onDidChange(() => void this.refresh(false)),
        );
    }

    /** Updates the test projects and discovers those whose build changed (all of them after building them first) */
    refresh(build: boolean): Promise<void> {
        const previous = this.refreshing ?? Promise.resolve();
        const next = previous.then(() => this.doRefresh(build)).catch(error => log.error('Refreshing tests failed:', error));
        this.refreshing = next;
        return next;
    }

    /**
     * Visual Studio's "Run Tests" / "Debug Tests" on a Solution Explorer node: the tests of the solution,
     * a project, or the classes in a folder or file. Builds and discovers first when they aren't known yet.
     */
    async runTestsAt(fsPath: string, debug: boolean): Promise<void> {
        if (this.states.size === 0) {
            await this.refresh(false);
        }
        let include = this.itemsAt(fsPath);
        if (include.length === 0) {
            await this.refresh(true);
            include = this.itemsAt(fsPath);
        }
        if (include.length === 0) {
            vscode.window.showInformationMessage(`No tests found in ${path.basename(fsPath)}.`);
            return;
        }

        void vscode.commands.executeCommand('workbench.view.testing.focus');
        const cancellation = new vscode.CancellationTokenSource();
        try {
            await this.run(new vscode.TestRunRequest(include), cancellation.token, debug);
        } finally {
            cancellation.dispose();
        }
    }

    /** The outermost test items of a solution (all projects), project, folder or file */
    private itemsAt(fsPath: string): vscode.TestItem[] {
        const roots: vscode.TestItem[] = [];
        this.controller.items.forEach(item => roots.push(item));
        if (sln(fsPath)) {
            return roots;
        }
        const found: vscode.TestItem[] = [];
        const visit = (item: vscode.TestItem) => {
            const itemPath = item.uri?.fsPath;
            if (itemPath && (itemPath === fsPath || itemPath.startsWith(fsPath + path.sep))) {
                found.push(item);
            } else {
                item.children.forEach(visit);
            }
        };
        roots.forEach(visit);
        return found;
    }

    private async doRefresh(build: boolean): Promise<void> {
        const configuration = BuildConfiguration.active;
        const candidates = this.deps.projects().filter(projectPath => {
            try {
                return isTestProjectCandidate(this.deps.readProject(projectPath));
            } catch {
                return false;
            }
        });

        for (const [key, { project }] of [...this.states]) {
            if (!candidates.includes(project.projectPath)) {
                this.dropState(key);
            }
        }

        // A few test projects at a time: each step starts dotnet (MSBuild, the build, the test app)
        await Promise.all(candidates.map(projectPath => dotnetQueue.next(async () => {
            const frameworks = await this.deps.frameworks(projectPath);
            const kept = new Set<string>();
            // Every target framework is tested, as in Visual Studio. Their builds share obj/, so one after the other
            for (const framework of frameworks.length > 0 ? frameworks : [undefined]) {
                const project = await this.deps.evaluate(projectPath, configuration, framework);
                if (!project) {
                    continue;
                }
                if (project.targetFramework) {
                    log.info(`${path.basename(projectPath)}: testing ${project.targetFramework}`);
                }
                if (!project.testingPlatform && !project.vstestConsolePath) {
                    log.info(`${path.basename(projectPath)} uses VSTest, but MSBuild doesn't say where vstest.console is`);
                    continue;
                }
                const key = stateKey(project);
                kept.add(key);
                let state = this.states.get(key);
                if (!state || state.project.targetPath !== project.targetPath) {
                    const name = path.parse(projectPath).name;
                    const item = this.controller.createTestItem(key, project.targetFramework ? `${name} (${project.targetFramework})` : name, vscode.Uri.file(projectPath));
                    this.controller.items.add(item);
                    state = { project, item };
                    this.states.set(key, state);
                }
                if (build) {
                    let output = '';
                    if (!await this.deps.build(projectPath, configuration, text => { output += text; }, project.targetFramework)) {
                        state.item.error = buildFailure(output);
                        log.info(`${path.basename(projectPath)}: ${buildFailure(output)}`);
                        continue;
                    }
                }
                await this.discoverIfChanged(state);
            }
            // A framework taken out of the project file
            for (const [key, { project }] of [...this.states]) {
                if (project.projectPath === projectPath && !kept.has(key)) {
                    this.dropState(key);
                }
            }
        })));
    }

    private dropState(key: string): void {
        const gone = this.controller.items.get(key);
        if (gone) {
            this.forgetChildren(gone);
        }
        this.controller.items.delete(key);
        this.states.delete(key);
    }

    /**
     * Discovers the tests of the project when its build changed since the last discovery (or that failed).
     * Without a build there is nothing to discover: the project item says so instead of looking empty.
     */
    private async discoverIfChanged(state: ProjectState): Promise<void> {
        const modified = this.deps.modified(state.project.targetPath);
        if (modified === undefined) {
            state.item.description = NOT_BUILT;
            return;
        }
        if (modified !== state.discoveredAt && await this.discover(state)) {
            state.discoveredAt = modified;
        }
    }

    /** False when discovering failed (the reason is on the project item) */
    private async discover(state: ProjectState): Promise<boolean> {
        const discovered: TestNode[] = [];
        try {
            if (state.project.testingPlatform) {
                const settings = this.testingPlatformSettings(state.project);
                const session = await connectTestApp(args => this.deps.start(state.project, [...args, ...settings.args], false, settings.environment));
                session.onUpdate(nodes => discovered.push(...nodes.filter(node => node['execution-state'] === 'discovered')));
                await session.discover();
                await session.close();
            } else {
                const session = await connectVsTest(port => this.deps.startVsTest(state.project, port));
                try {
                    for (const testCase of await session.discover([state.project.targetPath], this.vstestSettings(state.project))) {
                        this.vstestCases.set(testCase.Id, testCase);
                        discovered.push(vstestCaseNode(testCase));
                    }
                } finally {
                    await session.close();
                }
            }
        } catch (error) {
            log.error(`Discovering the tests of ${state.project.projectPath} failed:`, error);
            state.item.error = `Discovering tests failed: ${error instanceof Error ? error.message : error}`;
            state.item.description = undefined;
            return false;
        }
        state.item.error = undefined;
        state.item.description = undefined;
        // The old tree goes: its items and their nodes would otherwise stay in the maps for good (one tree per discovery)
        this.forgetChildren(state.item);
        state.item.children.replace(buildTestTree(discovered).map(entry => this.toItem(entry)));
        return true;
    }

    /** Drops the nodes (and the VSTest cases) of the items below `item` from the maps */
    private forgetChildren(item: vscode.TestItem): void {
        item.children.forEach(child => {
            this.forgetChildren(child);
            const node = this.nodes.get(child);
            if (node) {
                this.vstestCases.delete(node.uid);
            }
            this.nodes.delete(child);
        });
    }

    private toItem(entry: TreeEntry): vscode.TestItem {
        const item = this.controller.createTestItem(entry.id, entry.label, entry.file ? vscode.Uri.file(entry.file) : undefined);
        if (entry.line !== undefined) {
            item.range = new vscode.Range(entry.line - 1, 0, entry.line - 1, 0);
        }
        if (entry.node) {
            this.nodes.set(item, entry.node);
        }
        item.children.replace(entry.children.map(child => this.toItem(child)));
        return item;
    }

    private projectOf(item: vscode.TestItem): ProjectState | undefined {
        let root = item;
        while (root.parent) {
            root = root.parent;
        }
        return this.states.get(root.id);
    }

    private leaves(item: vscode.TestItem, exclude: readonly vscode.TestItem[]): vscode.TestItem[] {
        if (exclude.includes(item)) {
            return [];
        }
        if (this.nodes.has(item)) {
            return [item];
        }
        const result: vscode.TestItem[] = [];
        item.children.forEach(child => result.push(...this.leaves(child, exclude)));
        return result;
    }

    private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        // The refresh on load may still be adding test projects: run all of them, not those found so far
        await this.refreshing;
        if (this.states.size === 0) {
            await this.refresh(false);
        }
        const exclude = request.exclude ?? [];
        const roots: vscode.TestItem[] = [];
        if (request.include) {
            roots.push(...request.include);
        } else {
            this.controller.items.forEach(item => roots.push(item));
        }

        // Per project: the tests to run, or everything when the whole project was asked for
        const byProject = new Map<ProjectState, { items: Set<vscode.TestItem>; all: boolean }>();
        for (const root of roots) {
            const state = this.projectOf(root);
            if (!state) {
                continue;
            }
            const entry = byProject.get(state) ?? { items: new Set(), all: false };
            // By id: a refresh may have replaced the project's item since the request was made
            entry.all ||= root.id === state.item.id && exclude.length === 0;
            this.leaves(root, exclude).forEach(item => entry.items.add(item));
            byProject.set(state, entry);
        }

        const run = this.controller.createTestRun(request);
        const configuration = BuildConfiguration.active;
        // VSTest projects with the same vstest.console and run settings file run in one session, as in Visual Studio:
        // that is where the run settings' MaxCpuCount runs test assemblies in parallel. Projects that run through
        // Mono's vstest.console (.NET Framework outside Windows) are a group of their own.
        const vstestGroups = new Map<string, ProjectRun[]>();
        // Cancel stops the build that is running, not only the ones that follow
        const cancelled = new AbortController();
        const cancelListener = token.onCancellationRequested(() => cancelled.abort());
        try {
            for (const [state, { items, all }] of byProject) {
                if (token.isCancellationRequested) {
                    break;
                }
                items.forEach(item => run.enqueued(item));
                let output = '';
                const built = await this.deps.build(state.project.projectPath, configuration, text => { output += text; run.appendOutput(terminal(text)); }, state.project.targetFramework, cancelled.signal);
                if (token.isCancellationRequested) {
                    break;
                }
                if (!built) {
                    items.forEach(item => run.errored(item, new vscode.TestMessage(buildFailure(output))));
                    continue;
                }
                // Not discovered for this build yet (never built, or a framework not built before): discover first,
                // so the results have tests to go to and the tree fills in
                await this.discoverIfChanged(state);
                if (all && items.size === 0) {
                    this.leaves(state.item, []).forEach(item => run.enqueued(item));
                }
                const projectRun: ProjectRun = { state, items: all ? undefined : [...items] };
                if (state.project.testingPlatform) {
                    await this.runProjects([projectRun], run, token, debug);
                } else {
                    const vstestConsole = needsMono(state.project, this.deps.platform()) ? 'mono' : state.project.vstestConsolePath;
                    const key = JSON.stringify([vstestConsole, state.project.runSettingsPath ?? '']);
                    vstestGroups.set(key, [...(vstestGroups.get(key) ?? []), projectRun]);
                }
            }
            for (const group of vstestGroups.values()) {
                if (token.isCancellationRequested) {
                    break;
                }
                await this.runProjects(group, run, token, debug);
            }
        } finally {
            cancelListener.dispose();
            run.end();
        }
    }

    /**
     * Runs the projects' tests (one Microsoft.Testing.Platform project, or VSTest projects sharing a vstest.console
     * session) and reports the results
     */
    private async runProjects(projects: readonly ProjectRun[], run: vscode.TestRun, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        const byUid = new Map<string, vscode.TestItem>();
        const collect = (item: vscode.TestItem) => {
            const node = this.nodes.get(item);
            if (node) {
                byUid.set(node.uid, item);
            }
            item.children.forEach(collect);
        };
        projects.forEach(({ state }) => collect(state.item));

        /** Results of tests without an item, by uid (the last one of a test wins) */
        const unmatched = new Map<string, TestNode>();
        const report = (node: TestNode) => {
            const item = byUid.get(node.uid);
            const outcome = outcomeOf(node);
            if (!outcome) {
                return;
            }
            if (!item) {
                if (outcome.state !== 'started') {
                    unmatched.set(node.uid, node);
                }
                return;
            }
            const output = [node.standardOutput, node.standardError].filter(Boolean).join('\n');
            if (output) {
                run.appendOutput(terminal(`${output}\n`), undefined, item);
            }
            switch (outcome.state) {
                case 'started': run.started(item); break;
                case 'passed': run.passed(item, outcome.duration); break;
                case 'skipped': run.skipped(item); break;
                case 'failed':
                case 'errored': {
                    const text = outcome.stackTrace ? `${outcome.message}\n\n${outcome.stackTrace}` : outcome.message;
                    const message = outcome.expected !== undefined
                        ? vscode.TestMessage.diff(text, outcome.expected, outcome.actual ?? '')
                        : new vscode.TestMessage(text);
                    if (item.uri && item.range) {
                        message.location = new vscode.Location(item.uri, item.range);
                    }
                    if (outcome.state === 'failed') {
                        run.failed(item, message, outcome.duration);
                    } else {
                        run.errored(item, message, outcome.duration);
                    }
                    break;
                }
            }
        };
        /** Errors the tests (a project when none of its tests are known), the reason in the run output too */
        const fail = (error: unknown) => {
            const text = error instanceof Error ? error.message : String(error);
            run.appendOutput(terminal(`${text}\n`));
            const message = new vscode.TestMessage(text);
            for (const { state, items } of projects) {
                const failed = items ?? this.leaves(state.item, []);
                (failed.length > 0 ? failed : [state.item]).forEach(item => run.errored(item, message));
            }
        };

        if (projects[0].state.project.testingPlatform) {
            await this.runTestingPlatformProject(projects[0], run, token, debug, report, fail);
        } else {
            await this.runVsTestProjects(projects, run, token, debug, report, fail);
        }

        if (unmatched.size === 0) {
            return;
        }
        // Results of tests the tree doesn't have (discovered from another build, or not at all): discover again
        // so they get their items, and say so for any that still have none rather than dropping them
        if (!token.isCancellationRequested) {
            for (const { state } of projects) {
                const modified = this.deps.modified(state.project.targetPath);
                if (await this.discover(state) && modified !== undefined) {
                    state.discoveredAt = modified;
                }
            }
            byUid.clear();
            projects.forEach(({ state }) => collect(state.item));
        }
        const pending = [...unmatched.values()];
        unmatched.clear();
        pending.forEach(report);
        if (unmatched.size > 0) {
            const names = [...unmatched.values()].map(node => node['display-name']).join(', ');
            const of = projects.map(({ state }) => path.basename(state.project.projectPath)).join(', ');
            run.appendOutput(terminal(`${unmatched.size} result(s) of ${of} could not be matched to a test in the Testing view: ${names}\n`));
        }
    }

    /** Runs or debugs the tests of a Microsoft.Testing.Platform project through its server mode */
    private async runTestingPlatformProject(
        { state, items }: ProjectRun,
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        debug: boolean,
        report: (node: TestNode) => void,
        fail: (error: unknown) => void
    ): Promise<void> {
        const settings = this.testingPlatformSettings(state.project, text => run.appendOutput(terminal(text)));
        let session: TestSession;
        try {
            session = await connectTestApp(args => this.deps.start(state.project, [...args, ...settings.args], debug, settings.environment));
        } catch (error) {
            fail(error);
            return;
        }
        const cancel = token.onCancellationRequested(() => void session.close());

        session.onLog((level, message) => {
            if (!['Trace', 'Debug'].includes(level)) {
                run.appendOutput(terminal(message.endsWith('\n') ? message : `${message}\n`));
            }
        });
        session.onUpdate(nodes => nodes.forEach(report));

        try {
            const tests = items?.map(item => this.nodes.get(item)!).map(node => ({ uid: node.uid, 'display-name': node['display-name'] }));
            await session.run(tests);
        } catch (error) {
            run.appendOutput(terminal(`${error instanceof Error ? error.message : error}\n`));
        } finally {
            cancel.dispose();
            await session.close();
        }
    }

    /**
     * Runs or debugs (attaching to the test hosts) the tests of VSTest projects that share vstest.console and the
     * run settings file, in one vstest.console session
     */
    private async runVsTestProjects(
        projects: readonly ProjectRun[],
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        debug: boolean,
        report: (node: TestNode) => void,
        fail: (error: unknown) => void
    ): Promise<void> {
        const first = projects[0].state.project;
        if (debug && needsMono(first, this.deps.platform())) {
            fail(MONO_DEBUG_UNSUPPORTED);
            return;
        }
        let session: VsTestSession;
        try {
            session = await connectVsTest(port => this.deps.startVsTest(first, port));
        } catch (error) {
            fail(error);
            return;
        }
        const cancel = token.onCancellationRequested(() => void session.close());
        session.onLog(message => run.appendOutput(terminal(`${message}\n`)));

        try {
            // VSTest takes either whole assemblies or test cases: once a project runs only some tests, all go as test cases
            const testCases = projects.some(({ items }) => items)
                ? projects.flatMap(({ state, items }) => (items ?? this.leaves(state.item, [])).flatMap(item => this.vstestCases.get(this.nodes.get(item)!.uid) ?? []))
                : undefined;
            const runSettings = this.vstestSettings(first, text => run.appendOutput(terminal(text)));
            await session.run(
                { ...(testCases ? { testCases } : { sources: projects.map(({ state }) => state.project.targetPath) }), runSettings },
                results => results.map(vstestResultNode).forEach(report),
                debug ? processId => this.deps.attachDebugger(first, processId) : undefined
            );
        } catch (error) {
            run.appendOutput(terminal(`${error instanceof Error ? error.message : error}\n`));
        } finally {
            cancel.dispose();
            await session.close();
        }
    }

    /** The project's run settings file, or undefined when it has none or it can't be read (said in the output) */
    private runSettingsContent(project: TestProject, output?: (text: string) => void): string | undefined {
        if (!project.runSettingsPath) {
            return undefined;
        }
        const content = this.deps.readRunSettings(project.runSettingsPath);
        if (content === undefined) {
            this.warn(`The run settings file ${project.runSettingsPath} (RunSettingsFilePath of ${path.basename(project.projectPath)}) can't be read; running without it.\n`, output);
        }
        return content;
    }

    private warn(problem: string, output?: (text: string) => void): void {
        log.warn(problem.trimEnd());
        output?.(problem);
    }

    /** What VSTest gets: the project's run settings without data collectors and loggers; undefined for the default */
    private vstestSettings(project: TestProject, output?: (text: string) => void): string | undefined {
        const content = this.runSettingsContent(project, output);
        const settings = content === undefined ? undefined : vstestRunSettings(content);
        if (content !== undefined && settings === undefined) {
            this.warn(`${project.runSettingsPath} is not a run settings file (<RunSettings>); running without it.\n`, output);
        }
        return settings;
    }

    /**
     * What a Microsoft.Testing.Platform app gets: `--settings` with the project's run settings when the app has the
     * VSTest bridge (MSTest, NUnit runner; xUnit v3 and TUnit don't read run settings and would refuse the option),
     * and the file's environment variables (in the file they make the app restart as a test host that can't connect)
     */
    private testingPlatformSettings(project: TestProject, output?: (text: string) => void): { args: string[]; environment: Readonly<Record<string, string>> } {
        const none = { args: [], environment: {} };
        if (!project.runSettingsPath || !this.deps.hasVsTestBridge(project.targetPath)) {
            return none;
        }
        const content = this.runSettingsContent(project, output);
        const settings = content === undefined ? undefined : testingPlatformRunSettings(content);
        if (!settings) {
            if (content !== undefined) {
                this.warn(`${project.runSettingsPath} is not a run settings file (<RunSettings>); running without it.\n`, output);
            }
            return none;
        }
        return { args: ['--settings', this.deps.writeRunSettings(settings.settings)], environment: settings.environment };
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
