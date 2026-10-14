import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { logger } from '../../core/logger';
import { sln } from '../../core/utils';
import { SolutionService } from '../solutionService';
import { BuildConfiguration } from '../buildConfiguration';
import { DOTNET_TASK_TYPE } from '../dotnetTaskProvider';
import { EMIT_GENERATED_FILES } from '../analyzers';
import { Settings } from '../settings';
import { connectTestApp, TestApp, TestNode, TestSession } from './testingPlatformClient';
import { buildTestTree, outcomeOf, TreeEntry } from './testTree';
import { evaluateTestProject, isTestProjectCandidate, TestProject } from './testProjects';
import { connectVsTest, VsTestCase, vstestCaseNode, vstestResultNode, VsTestSession } from './vstestClient';

const log = logger('TestExplorer');

/** What the Test Explorer needs from the outside; replaced in tests */
export interface TestExplorerDeps {
    /** Project files of the active solution */
    projects(): string[];
    readProject(projectPath: string): string;
    evaluate(projectPath: string, configuration: string): Promise<TestProject | undefined>;
    /** Builds the project; false when the build failed */
    build(projectPath: string, configuration: string, output: (text: string) => void): Promise<boolean>;
    /** Starts the test app with the server arguments, in the debugger for debug runs */
    start(project: TestProject, args: string[], debug: boolean): Promise<TestApp>;
    /** Starts vstest.console in design mode, connecting to the port (VSTest projects) */
    startVsTest(project: TestProject, port: number): Promise<TestApp>;
    /** Attaches the debugger to a test host VSTest started paused; false when it couldn't */
    attachDebugger(project: TestProject, processId: number): Promise<boolean>;
    /** Last write time of the test app, to re-discover only what a build changed */
    modified(file: string): number | undefined;
}

function startProcess(project: TestProject, args: string[]): Promise<TestApp> {
    const child = spawn('dotnet', [project.targetPath, ...args], {
        cwd: path.dirname(project.projectPath),
        env: { ...process.env, TESTINGPLATFORM_TELEMETRY_OPTOUT: '1' },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += String(error); });
    return Promise.resolve({ kill: () => { child.kill(); }, output: () => output });
}

async function startInDebugger(project: TestProject, args: string[]): Promise<TestApp> {
    const name = `Debug tests: ${path.parse(project.projectPath).name}`;
    let session: vscode.DebugSession | undefined;
    const listener = vscode.debug.onDidStartDebugSession(started => {
        if (started.name === name) {
            session = started;
        }
    });
    const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'coreclr',
        request: 'launch',
        name,
        program: project.targetPath,
        args,
        cwd: path.dirname(project.projectPath),
        env: { TESTINGPLATFORM_TELEMETRY_OPTOUT: '1' },
        console: 'internalConsole',
    });
    listener.dispose();
    if (!started) {
        throw new Error('The debugger could not be started (is a C# extension installed?).');
    }
    return { kill: () => { void vscode.debug.stopDebugging(session); }, output: () => '' };
}

function startVsTestConsole(project: TestProject, port: number): Promise<TestApp> {
    const child = spawn('dotnet', [project.vstestConsolePath!, `--port:${port}`, `--parentprocessid:${process.pid}`], {
        cwd: path.dirname(project.projectPath),
        env: { ...process.env, VSTEST_TELEMETRY_OPTEDIN: '0' },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += String(error); });
    return Promise.resolve({ kill: () => { child.kill(); }, output: () => output });
}

async function attachToTestHost(project: TestProject, processId: number): Promise<boolean> {
    return vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'coreclr',
        request: 'attach',
        name: `Debug tests: ${path.parse(project.projectPath).name}`,
        processId,
    });
}

const defaultDeps: TestExplorerDeps = {
    projects: () => [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])],
    readProject: projectPath => fs.readFileSync(projectPath, 'utf8'),
    evaluate: evaluateTestProject,
    build: (projectPath, configuration, output) => new Promise(resolve => {
        execFile('dotnet', ['build', projectPath, '--configuration', configuration, '-nologo', '-consoleLoggerParameters:NoSummary', ...(Settings.emitGeneratedFiles() ? [EMIT_GENERATED_FILES] : [])],
            { cwd: path.dirname(projectPath), timeout: 600000 }, (error, stdout, stderr) => {
                output(`${stdout}${stderr}`);
                resolve(!error);
            });
    }),
    start: (project, args, debug) => debug ? startInDebugger(project, args) : startProcess(project, args),
    startVsTest: startVsTestConsole,
    attachDebugger: attachToTestHost,
    modified: file => {
        try {
            return fs.statSync(file).mtimeMs;
        } catch {
            return undefined;
        }
    },
};

const terminal = (text: string) => text.replace(/\r?\n/g, '\r\n');

interface ProjectState {
    project: TestProject;
    item: vscode.TestItem;
    discoveredAt?: number;
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

        for (const projectPath of [...this.states.keys()].filter(p => !candidates.includes(p))) {
            this.controller.items.delete(projectPath);
            this.states.delete(projectPath);
        }

        await Promise.all(candidates.map(async projectPath => {
            const project = await this.deps.evaluate(projectPath, configuration);
            if (!project) {
                return;
            }
            if (!project.testingPlatform && !project.vstestConsolePath) {
                log.info(`${path.basename(projectPath)} uses VSTest, but MSBuild doesn't say where vstest.console is`);
                return;
            }
            let state = this.states.get(projectPath);
            if (!state || state.project.targetPath !== project.targetPath) {
                const item = this.controller.createTestItem(projectPath, path.parse(projectPath).name, vscode.Uri.file(projectPath));
                this.controller.items.add(item);
                state = { project, item };
                this.states.set(projectPath, state);
            }
            if (build && !await this.deps.build(projectPath, configuration, text => log.debug(text))) {
                state.item.error = 'Build failed, see the Problems panel';
                return;
            }
            const modified = this.deps.modified(project.targetPath);
            if (modified !== undefined && modified !== state.discoveredAt) {
                await this.discover(state);
                state.discoveredAt = modified;
            }
        }));
    }

    private async discover(state: ProjectState): Promise<void> {
        const discovered: TestNode[] = [];
        try {
            if (state.project.testingPlatform) {
                const session = await connectTestApp(args => this.deps.start(state.project, args, false));
                session.onUpdate(nodes => discovered.push(...nodes.filter(node => node['execution-state'] === 'discovered')));
                await session.discover();
                await session.close();
            } else {
                const session = await connectVsTest(port => this.deps.startVsTest(state.project, port));
                try {
                    for (const testCase of await session.discover([state.project.targetPath])) {
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
            return;
        }
        state.item.error = undefined;
        state.item.children.replace(buildTestTree(discovered).map(entry => this.toItem(entry)));
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
            entry.all ||= root === state.item && exclude.length === 0;
            this.leaves(root, exclude).forEach(item => entry.items.add(item));
            byProject.set(state, entry);
        }

        const run = this.controller.createTestRun(request);
        const configuration = BuildConfiguration.active;
        try {
            for (const [state, { items, all }] of byProject) {
                if (token.isCancellationRequested) {
                    break;
                }
                items.forEach(item => run.enqueued(item));
                if (!await this.deps.build(state.project.projectPath, configuration, text => run.appendOutput(terminal(text)))) {
                    items.forEach(item => run.errored(item, new vscode.TestMessage('Build failed, see the Problems panel')));
                    continue;
                }
                await this.runProject(state, all ? undefined : [...items], run, token, debug);
            }
        } finally {
            run.end();
        }
    }

    private async runProject(state: ProjectState, items: vscode.TestItem[] | undefined, run: vscode.TestRun, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        const byUid = new Map<string, vscode.TestItem>();
        const collect = (item: vscode.TestItem) => {
            const node = this.nodes.get(item);
            if (node) {
                byUid.set(node.uid, item);
            }
            item.children.forEach(collect);
        };
        collect(state.item);

        const report = (node: TestNode) => {
            const item = byUid.get(node.uid);
            const outcome = outcomeOf(node);
            if (!item || !outcome) {
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
                    outcome.state === 'failed' ? run.failed(item, message, outcome.duration) : run.errored(item, message, outcome.duration);
                    break;
                }
            }
        };
        const fail = (error: unknown) => {
            const message = new vscode.TestMessage(error instanceof Error ? error.message : String(error));
            (items ?? [...byUid.values()]).forEach(item => run.errored(item, message));
        };

        if (!state.project.testingPlatform) {
            await this.runVsTestProject(state, items, run, token, debug, report, fail);
            return;
        }

        let session: TestSession;
        try {
            session = await connectTestApp(args => this.deps.start(state.project, args, debug));
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

    /** Runs or debugs (attaching to the test host) the tests of a VSTest project through vstest.console */
    private async runVsTestProject(
        state: ProjectState,
        items: vscode.TestItem[] | undefined,
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        debug: boolean,
        report: (node: TestNode) => void,
        fail: (error: unknown) => void
    ): Promise<void> {
        let session: VsTestSession;
        try {
            session = await connectVsTest(port => this.deps.startVsTest(state.project, port));
        } catch (error) {
            fail(error);
            return;
        }
        const cancel = token.onCancellationRequested(() => void session.close());
        session.onLog(message => run.appendOutput(terminal(`${message}\n`)));

        try {
            const testCases = items?.flatMap(item => this.vstestCases.get(this.nodes.get(item)!.uid) ?? []);
            await session.run(
                testCases ? { testCases } : { sources: [state.project.targetPath] },
                results => results.map(vstestResultNode).forEach(report),
                debug ? processId => this.deps.attachDebugger(state.project, processId) : undefined
            );
        } catch (error) {
            run.appendOutput(terminal(`${error instanceof Error ? error.message : error}\n`));
        } finally {
            cancel.dispose();
            await session.close();
        }
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
