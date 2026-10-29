import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { Solution } from '../../core/Solution';
import { SolutionService } from '../../services/solution/solutionService';
import { BuildConfiguration } from '../../services/build/buildConfiguration';
import { parseProjectConfigurations } from '../../parsers/projectConfigurations';
import { readConfigurationModel, renderConfigurationModel } from '../../services/build/configurationManager/configurationManager';
import { applyRequest } from '../../services/build/configurationManager/requests';
import { ConfigurationManagerMessage, ConfigurationManagerProject, ConfigurationManagerRequest, ConfigurationManagerState } from '../../types/configurationManager';
import { TemplateWizardWebview } from './views/TemplateWizardWebview';

const log = logger('ConfigurationManagerPanel');

/** Visual Studio's Configuration Manager, in an editor tab */
export class ConfigurationManagerPanel {
    static extensionUri: vscode.Uri | undefined;
    private static current: ConfigurationManagerPanel | undefined;

    /** Opens (or shows) the Configuration Manager tab */
    static show(): void {
        if (!SolutionService.getActiveSolution()) {
            vscode.window.showInformationMessage('Open a solution to use the Configuration Manager.');
            return;
        }
        if (this.current) {
            this.current.panel.reveal();
            return;
        }
        if (!this.extensionUri) {
            log.error('ConfigurationManagerPanel.extensionUri is not set');
            return;
        }
        this.current = new ConfigurationManagerPanel(this.extensionUri);
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly subscriptions: vscode.Disposable[] = [];
    private solution: Solution | undefined;

    private constructor(extensionUri: vscode.Uri) {
        const title = 'Configuration Manager';
        this.panel = vscode.window.createWebviewPanel('shinobi.configurationManager', title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
        });
        this.panel.webview.html = TemplateWizardWebview.getHtmlForWebview(extensionUri, this.panel.webview, title, 'configuration-view');
        this.subscriptions.push(
            this.panel.webview.onDidReceiveMessage((request: ConfigurationManagerRequest) => this.handle(request).catch(error => {
                log.error(`${request.type} failed:`, error);
                void this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            })),
            BuildConfiguration.onDidChange(() => void this.postState()),
        );
        this.watchSolution();
        // Open Solution replaces the solution: follow the new one
        this.subscriptions.push(SolutionService.onDidChangeActiveSolution(() => {
            this.watchSolution();
            void this.postState();
        }));
        this.panel.onDidDispose(() => {
            ConfigurationManagerPanel.current = undefined;
            this.solutionChanges?.dispose();
            this.subscriptions.forEach(subscription => subscription.dispose());
        });
    }

    /** Refreshes the tab when the solution open at that time changes */
    private watchSolution(): void {
        this.solutionChanges?.dispose();
        this.solutionChanges = undefined;
        this.solution = SolutionService.getActiveSolution();
        this.solutionChanges = this.solution?.onDidChange(() => void this.postState());
    }

    private solutionChanges: { dispose(): void } | undefined;

    private post(message: ConfigurationManagerMessage): Thenable<boolean> {
        return this.panel.webview.postMessage(message);
    }

    private async state(solution: Solution): Promise<ConfigurationManagerState> {
        const model = solution.configurationModel;
        const projects: ConfigurationManagerProject[] = await Promise.all(solution.configurationProjects.map(async ref => {
            const xml = await fs.promises.readFile(path.resolve(path.dirname(solution.solutionPath), ref.path), 'utf8').catch(() => '');
            return { path: ref.path, name: path.basename(ref.path, path.extname(ref.path)), ...await parseProjectConfigurations(xml) };
        }));
        const mappings: ConfigurationManagerState['mappings'] = {};
        for (const [project, forProject] of Object.entries(model.mappings)) {
            for (const [pair, mapping] of Object.entries(forProject)) {
                mappings[`${project}|${pair}`] = mapping;
            }
        }
        return {
            configurations: model.configurations,
            platforms: model.platforms,
            activeConfiguration: BuildConfiguration.active,
            activePlatform: BuildConfiguration.activePlatform,
            projects,
            mappings,
        };
    }

    private async postState(): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (solution) {
            await this.post({ type: 'state', state: await this.state(solution) });
        }
    }

    private async handle(request: ConfigurationManagerRequest): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            throw new Error('No solution is open.');
        }
        switch (request.type) {
            case 'ready':
                break;
            case 'setActive':
                await BuildConfiguration.set(request.configuration);
                await BuildConfiguration.setPlatform(request.platform);
                break;
            default: {
                const refs = solution.configurationProjects;
                const paths = refs.map(ref => ref.path);
                // Throws, and so writes nothing, for invalid input
                await solution.editSolutionText((content, type) =>
                    renderConfigurationModel(type, content, applyRequest(readConfigurationModel(type, content, refs), request, paths), refs));
            }
        }
        await this.postState();
    }
}
