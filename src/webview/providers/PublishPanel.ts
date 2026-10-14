import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { PublishInit, PublishMessage, PublishRequest } from '../../types/publish';
import { TemplateWizardWebview } from './views/TemplateWizardWebview';
import {
    applySettings, defaultFolderSettings, folderProfileXml, listProfiles, newProfileName, profilesFolder, PublishProfile, publishDirOf,
} from '../../services/publish/publishProfiles';
import { BuildConfiguration } from '../../services/buildConfiguration';
import { DebugConfigService } from '../../services/debugConfigService';
import { createDotnetTask, DOTNET_TASK_TYPE } from '../../services/dotnetTaskProvider';
import { runTask } from '../../services/runTask';

const log = logger('PublishPanel');

/** Target runtimes Visual Studio offers for Folder profiles, besides "Portable" */
const RUNTIMES = ['win-x64', 'win-x86', 'win-arm64', 'osx-x64', 'osx-arm64', 'linux-x64', 'linux-arm64', 'linux-musl-x64', 'linux-musl-arm64'];
const LAST_PUBLISHED_KEY = 'shinobi.publish.lastPublished';

/** This machine's runtime identifier, e.g. linux-x64 */
function hostRuntime(): string {
    const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'osx' : 'linux';
    return `${os}-${process.arch === 'ia32' ? 'x86' : process.arch}`;
}

/** Visual Studio's Publish page for a project, in an editor tab */
export class PublishPanel {
    static extensionUri: vscode.Uri | undefined;
    /** Workspace state: when each profile was last published */
    static state: vscode.Memento | undefined;
    private static readonly open = new Map<string, PublishPanel>();

    /** Opens (or shows) the Publish tab of a project */
    static show(projectPath: string): void {
        const existing = this.open.get(projectPath);
        if (existing) {
            existing.panel.reveal();
            return;
        }
        if (!this.extensionUri) {
            log.error('PublishPanel.extensionUri is not set');
            return;
        }
        this.open.set(projectPath, new PublishPanel(projectPath, this.extensionUri));
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly projectName: string;

    private constructor(private readonly projectPath: string, extensionUri: vscode.Uri) {
        this.projectName = path.basename(projectPath, path.extname(projectPath));
        const title = `Publish: ${this.projectName}`;
        this.panel = vscode.window.createWebviewPanel('shinobi.publish', title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
        });
        this.panel.webview.html = TemplateWizardWebview.getHtmlForWebview(extensionUri, this.panel.webview, title, 'publish-view');
        this.panel.onDidDispose(() => PublishPanel.open.delete(projectPath));
        this.panel.webview.onDidReceiveMessage((request: PublishRequest) => this.handle(request).catch(error => {
            log.error(`${request.type} failed:`, error);
            void this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }));
    }

    private post(message: PublishMessage): Thenable<boolean> {
        return this.panel.webview.postMessage(message);
    }

    private profile(name: string): PublishProfile {
        const profile = listProfiles(this.projectPath).find(p => p.name === name);
        if (!profile) {
            throw new Error(`The publish profile ${name} no longer exists.`);
        }
        return profile;
    }

    private lastPublished(): Record<string, string> {
        return PublishPanel.state?.get<Record<string, string>>(LAST_PUBLISHED_KEY) ?? {};
    }

    private async init(selected?: string): Promise<void> {
        const frameworks = await DebugConfigService.extractTargetFrameworks(this.projectPath);
        const lastPublished = this.lastPublished();
        const payload: PublishInit = {
            projectName: this.projectName,
            profiles: listProfiles(this.projectPath).map(profile => ({
                name: profile.name,
                target: profile.target,
                settings: profile.settings,
                publishFolder: publishDirOf(this.projectPath, profile.settings.publishDir),
                lastPublished: lastPublished[profile.path],
            })),
            selected,
            configurations: [...BuildConfiguration.available],
            frameworks,
            runtimes: RUNTIMES,
            hostRuntime: hostRuntime(),
            newProfile: defaultFolderSettings(frameworks[0]),
        };
        await this.post({ type: 'init', payload });
    }

    private async handle(request: PublishRequest): Promise<void> {
        switch (request.type) {
            case 'ready':
                await this.init();
                break;

            case 'publish': {
                const profile = this.profile(request.profile);
                await this.post({ type: 'publishing', profile: profile.name });
                const exitCode = await runTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'publish', target: this.projectPath, profile: profile.name }));
                const succeeded = exitCode === 0;
                if (succeeded) {
                    await PublishPanel.state?.update(LAST_PUBLISHED_KEY, { ...this.lastPublished(), [profile.path]: new Date().toISOString() });
                }
                await this.init(profile.name);
                await this.post({ type: 'published', profile: profile.name, succeeded });
                break;
            }

            case 'createProfile': {
                const name = newProfileName(listProfiles(this.projectPath).map(p => p.name));
                const frameworks = await DebugConfigService.extractTargetFrameworks(this.projectPath);
                const folder = profilesFolder(this.projectPath);
                await fs.promises.mkdir(folder, { recursive: true });
                await fs.promises.writeFile(path.join(folder, `${name}.pubxml`),
                    folderProfileXml({ ...defaultFolderSettings(frameworks[0]), publishDir: request.publishDir }), 'utf8');
                await this.init(name);
                break;
            }

            case 'saveSettings': {
                const profile = this.profile(request.profile);
                const xml = await fs.promises.readFile(profile.path, 'utf8');
                await fs.promises.writeFile(profile.path, applySettings(xml, request.settings), 'utf8');
                await this.init(profile.name);
                break;
            }

            case 'renameProfile': {
                const profile = this.profile(request.profile);
                const taken = listProfiles(this.projectPath).map(p => p.name.toLowerCase());
                const name = await vscode.window.showInputBox({
                    title: 'Rename publish profile',
                    value: profile.name,
                    validateInput: value => !value.trim() ? 'Enter a name'
                        : /[\\/:*?"<>|]/.test(value) ? 'The name can\'t contain \\ / : * ? " < > |'
                            : value.trim().toLowerCase() !== profile.name.toLowerCase() && taken.includes(value.trim().toLowerCase()) ? 'A profile with that name exists'
                                : undefined,
                });
                if (!name || name.trim() === profile.name) {
                    break;
                }
                const target = path.join(path.dirname(profile.path), `${name.trim()}.pubxml`);
                await fs.promises.rename(profile.path, target);
                // Visual Studio's per-user settings of the profile go along
                if (fs.existsSync(`${profile.path}.user`)) {
                    await fs.promises.rename(`${profile.path}.user`, `${target}.user`);
                }
                await this.init(name.trim());
                break;
            }

            case 'deleteProfile': {
                const profile = this.profile(request.profile);
                const choice = await vscode.window.showWarningMessage(`Delete the publish profile '${profile.name}'?`, { modal: true }, 'Delete');
                if (choice !== 'Delete') {
                    break;
                }
                await fs.promises.rm(profile.path, { force: true });
                await fs.promises.rm(`${profile.path}.user`, { force: true });
                await this.init();
                break;
            }

            case 'openProfile':
                await vscode.window.showTextDocument(vscode.Uri.file(this.profile(request.profile).path));
                break;

            case 'openFolder': {
                const folder = publishDirOf(this.projectPath, this.profile(request.profile).settings.publishDir);
                if (!fs.existsSync(folder)) {
                    vscode.window.showInformationMessage(`${folder} doesn't exist yet. Publish first.`);
                    break;
                }
                await vscode.env.openExternal(vscode.Uri.file(folder));
                break;
            }

            case 'browseFolder': {
                const [picked] = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    defaultUri: vscode.Uri.file(publishDirOf(this.projectPath, request.current || '.')),
                    openLabel: 'Select Folder',
                }) ?? [];
                if (picked) {
                    // Inside the project the location stays relative, like Visual Studio's default
                    const relative = path.relative(path.dirname(this.projectPath), picked.fsPath);
                    const location = relative === '' ? './'
                        : !relative.startsWith('..') && !path.isAbsolute(relative) ? `${relative.split(path.sep).join('/')}/`
                            : picked.fsPath;
                    await this.post({ type: 'folderPicked', path: location });
                }
                break;
            }
        }
    }
}
