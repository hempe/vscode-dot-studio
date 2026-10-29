import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { Solution } from '../../core/Solution';
import { SolutionService } from '../../services/solution/solutionService';
import { DebugConfigService } from '../../services/debug/debugConfigService';
import { UnloadedProjects } from '../../services/solution/unloadedProjects';
import { StartupChoice, readStartupProfiles, writeStartupProfiles } from '../../services/debug/startupProfiles/startupChoice';
import { slnLaunchPaths } from '../../services/debug/startupProfiles/slnLaunch';
import { currentSingle, refreshStartup } from '../../services/debug/startupProfiles/startProfile';
import { planRequest, toEntry } from '../../services/debug/startupProfiles/requests';
import { StartupProfileEntry, StartupProjectsMessage, StartupProjectsRequest, StartupProjectsState } from '../../types/startupProjects';
import { TemplateWizardWebview } from './views/TemplateWizardWebview';

const log = logger('StartupProjectsPanel');

/** Visual Studio's Configure Startup Projects (Solution Properties), in an editor tab */
export class StartupProjectsPanel {
    static extensionUri: vscode.Uri | undefined;
    private static current: StartupProjectsPanel | undefined;

    /** Opens (or shows) the Configure Startup Projects tab */
    static show(): void {
        if (!SolutionService.getActiveSolution()) {
            vscode.window.showInformationMessage('Open a solution to configure its startup projects.');
            return;
        }
        if (this.current) {
            this.current.panel.reveal();
            return;
        }
        if (!this.extensionUri) {
            log.error('StartupProjectsPanel.extensionUri is not set');
            return;
        }
        this.current = new StartupProjectsPanel(this.extensionUri);
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly subscriptions: vscode.Disposable[] = [];

    private constructor(extensionUri: vscode.Uri) {
        const title = 'Configure Startup Projects';
        this.panel = vscode.window.createWebviewPanel('shinobi.startupProjects', title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
        });
        this.panel.webview.html = TemplateWizardWebview.getHtmlForWebview(extensionUri, this.panel.webview, title, 'startup-view');
        this.subscriptions.push(
            this.panel.webview.onDidReceiveMessage((request: StartupProjectsRequest) => this.handle(request).catch(error => {
                log.error(`${request.type} failed:`, error);
                void this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            })),
            StartupChoice.onDidChange(() => void this.postState()),
        );
        this.watchSolution();
        // Open Solution replaces the solution: follow the new one
        this.subscriptions.push(SolutionService.onDidChangeActiveSolution(() => {
            this.watchSolution();
            void this.postState();
        }));
        this.panel.onDidDispose(() => {
            StartupProjectsPanel.current = undefined;
            this.solutionWatchers.forEach(watcher => watcher.dispose());
            this.subscriptions.forEach(subscription => subscription.dispose());
        });
    }

    /** Refreshes the tab when the solution or its profile files change (in Visual Studio, by hand) */
    private watchSolution(): void {
        this.solutionWatchers.forEach(watcher => watcher.dispose());
        this.solutionWatchers = [];
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return;
        }
        const files = slnLaunchPaths(solution.solutionPath);
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path.dirname(files.shared), `${path.basename(files.shared)}*`));
        const changed = () => void this.postState();
        this.solutionWatchers = [solution.onDidChange(changed), watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed)];
    }

    /** What listens to the solution that is open now; replaced when another solution is opened */
    private solutionWatchers: { dispose(): void }[] = [];

    private post(message: StartupProjectsMessage): Thenable<boolean> {
        return this.panel.webview.postMessage(message);
    }

    private state(solution: Solution): StartupProjectsState {
        const solutionDir = path.dirname(solution.solutionPath);
        const relative = (absolute: string) => path.relative(solutionDir, absolute).replace(/\\/g, '/');
        const projects = solution.configurationProjects.map(ref => {
            const absolute = path.resolve(solutionDir, ref.path);
            return {
                path: ref.path,
                name: path.basename(ref.path, path.extname(ref.path)),
                launchProfiles: DebugConfigService.launchProfileNames(absolute),
                unloaded: UnloadedProjects.isUnloaded(solution.solutionPath, absolute),
                // The projects "Set as Startup Project" is offered on: the ones that can be started and are loaded
                startable: !!solution.getProject(absolute)?.isExecutable && !UnloadedProjects.isUnloaded(solution.solutionPath, absolute),
            };
        });
        const files = readStartupProfiles(solution.solutionPath);
        const resolved = StartupChoice.resolve(solution.solutionPath);
        const single = DebugConfigService.getStartupProject() ?? StartupChoice.rememberedSingle(solution.solutionPath)?.projectPath;
        const profiles: StartupProfileEntry[] = [
            ...files.shared.profiles.map(profile => toEntry(profile, 'shared')),
            ...files.user.profiles.map(profile => toEntry(profile, 'user')),
        ];
        return {
            projects: projects.map(({ startable: _startable, ...project }) => project),
            startable: projects.filter(project => project.startable).map(project => project.path),
            singleProject: single ? relative(single) : undefined,
            active: resolved.kind === 'profile' ? { name: resolved.profile.name, shared: resolved.source === 'shared' } : undefined,
            profiles,
            unreadable: [files.shared, files.user].filter(file => file.error).map(file => `${path.basename(file.path)} cannot be read: ${file.error}`),
        };
    }

    private async postState(): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (solution) {
            await this.post({ type: 'state', state: this.state(solution) });
        }
    }

    private async handle(request: StartupProjectsRequest): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            throw new Error('No solution is open.');
        }
        const solutionPath = solution.solutionPath;
        switch (request.type) {
            case 'ready':
                break;
            case 'useSingle':
                await StartupChoice.chooseSingle(solutionPath);
                break;
            case 'setSingle':
                // The same path as "Set as Startup Project"; it also ends an active profile
                await solution.setStartupProject(path.resolve(path.dirname(solutionPath), request.project));
                break;
            case 'applyProfile':
            case 'deleteProfile': {
                // Throws, and so writes nothing, for invalid input and for a file that cannot be read
                const plan = planRequest(readStartupProfiles(solutionPath), request);
                const single = currentSingle();
                for (const write of plan.writes) {
                    writeStartupProfiles(solutionPath, write.source, write.profiles);
                }
                if (plan.active) {
                    await StartupChoice.chooseProfile(solutionPath, plan.active, single);
                } else if (request.type === 'deleteProfile') {
                    const active = StartupChoice.profileRef(solutionPath);
                    if (active?.name === request.name && (active.source === 'shared') === request.shared) {
                        await StartupChoice.chooseSingle(solutionPath);
                    }
                }
                await refreshStartup();
                break;
            }
        }
        await this.postState();
    }
}
