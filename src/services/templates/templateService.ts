import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NamespaceService } from '../namespaceService';
import { DebugConfigService } from '../debugConfigService';
import { DotnetTemplate, listTemplates, supportsLanguage } from './dotnetNewList';
import { BUILTIN_ITEMS, BuiltinItemKind, builtinItemContent, defaultTemplateItemName, itemBaseName, projectLanguage, replaceNamespace } from './itemTemplates';
import { defaultProjectLocation, findProjectFile, frameworkChoices, isValidProjectName, mostCommonFramework } from './newProject';

const log = logger('Templates');
const RECENT_PROJECT_TEMPLATES = 'shinobi.recentProjectTemplates';

let globalState: vscode.Memento | undefined;
let output: vscode.OutputChannel | undefined;

/** Called on activation: recently used project templates are kept per user */
export function initializeTemplates(state: vscode.Memento): void {
    globalState = state;
}

function outputChannel(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET: Templates');
}

async function showFailure(message: string): Promise<void> {
    if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') {
        outputChannel().show();
    }
}

function dotnet(args: string[], cwd: string): Promise<{ code: number; output: string }> {
    outputChannel().appendLine(`> dotnet ${args.join(' ')}`);
    return new Promise(resolve => {
        execFile('dotnet', args, { cwd, timeout: 300000 }, (error, stdout, stderr) => {
            const result = { code: error ? 1 : 0, output: `${stdout}${stderr}` };
            outputChannel().appendLine(result.output);
            resolve(result);
        });
    });
}

/** The project a file or folder belongs to: the one with the deepest directory containing it */
export function projectForPath(fileOrFolder: string): string | undefined {
    const projects = [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])];
    return projects
        .filter(project => {
            const relative = path.relative(path.dirname(project), fileOrFolder);
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        })
        .sort((a, b) => b.length - a.length)[0];
}

/** A built-in C# item or a `dotnet new` item template */
export type ItemChoice =
    | { readonly kind: 'builtin'; readonly item: BuiltinItemKind; readonly defaultName: string }
    | { readonly kind: 'template'; readonly template: DotnetTemplate; readonly language: string; readonly defaultName: string };

/** Whether the item needs a name; config templates (no language) don't */
export function itemNeedsName(choice: ItemChoice): boolean {
    return choice.kind === 'builtin' || choice.template.languages.length > 0;
}

export async function pickItemTemplate(projectPath: string): Promise<ItemChoice | undefined> {
    const language = projectLanguage(projectPath);
    type Item = vscode.QuickPickItem & { choice?: ItemChoice };
    const items: Item[] = language === 'C#'
        ? BUILTIN_ITEMS.map(item => ({ label: item.label, description: item.defaultName, choice: { kind: 'builtin', item: item.kind, defaultName: item.defaultName } }))
        : [];

    const templates = (await listTemplates('item')).filter(template => supportsLanguage(template, language));
    const groups = new Map<string, DotnetTemplate[]>();
    for (const template of templates) {
        const group = template.tags[0] ?? 'Other';
        groups.set(group, [...(groups.get(group) ?? []), template]);
    }
    for (const [group, groupTemplates] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
        for (const template of groupTemplates.sort((a, b) => a.name.localeCompare(b.name))) {
            items.push({
                label: template.name,
                description: template.shortNames[0],
                choice: { kind: 'template', template, language, defaultName: defaultTemplateItemName(template) },
            });
        }
    }

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Add New Item', matchOnDescription: true });
    return picked?.choice;
}

/**
 * Creates the item in `folder` and returns the file to open. Built-in items are written directly; `dotnet new`
 * templates run in the folder and get the folder's namespace afterwards.
 */
export async function createItem(choice: ItemChoice, folder: string, name: string, projectPath: string): Promise<string | undefined> {
    if (choice.kind === 'builtin') {
        const fileName = /\.cs$/i.test(name) ? name : `${name}.cs`;
        const filePath = path.join(folder, fileName);
        if (fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`${fileName} already exists.`);
            return undefined;
        }
        const namespace = await NamespaceService.calculateExpectedNamespace(filePath, projectPath) ?? itemBaseName(path.basename(projectPath));
        await fs.promises.writeFile(filePath, builtinItemContent(choice.item, path.parse(fileName).name, namespace));
        return filePath;
    }

    const before = new Set(listFiles(folder));
    const { template } = choice;
    const args = ['new', template.shortNames[0], '-o', folder];
    if (itemNeedsName(choice)) {
        args.push('-n', itemBaseName(name));
    }
    if (template.languages.length > 1 && template.languages.includes(choice.language)) {
        args.push('--language', choice.language);
    }
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Adding ${template.name}...` },
        () => dotnet(args, folder));
    if (result.code !== 0) {
        void showFailure(`Adding ${template.name} failed.`);
        return undefined;
    }

    const created = listFiles(folder).filter(file => !before.has(file));
    for (const file of created.filter(file => file.endsWith('.cs'))) {
        const namespace = await NamespaceService.calculateExpectedNamespace(file, projectPath);
        if (namespace) {
            const content = await fs.promises.readFile(file, 'utf8');
            await fs.promises.writeFile(file, replaceNamespace(content, namespace));
        }
    }
    return created.find(file => /\.(razor|cshtml)$/i.test(file)) ?? created.find(file => file.endsWith('.cs')) ?? created[0];
}

function listFiles(folder: string): string[] {
    return fs.existsSync(folder)
        ? fs.readdirSync(folder, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => path.join(entry.parentPath, entry.name))
        : [];
}

/** "Add New Project...": template, name, location, then `dotnet new` and add it to the solution (folder) */
export async function addNewProject(solutionFolderPath?: string): Promise<void> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        vscode.window.showErrorMessage('No active solution found');
        return;
    }
    const solutionDir = path.dirname(solution.solutionPath);

    const recent = globalState?.get<string[]>(RECENT_PROJECT_TEMPLATES) ?? [];
    const templates = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Reading project templates...' },
        () => listTemplates('project'));
    type Item = vscode.QuickPickItem & { template?: DotnetTemplate };
    const item = (template: DotnetTemplate): Item => ({
        label: template.name, description: template.shortNames[0], detail: template.tags.join(' / '), template,
    });
    const items: Item[] = [];
    const recentTemplates = recent.map(shortName => templates.find(t => t.shortNames[0] === shortName)).filter((t): t is DotnetTemplate => !!t);
    if (recentTemplates.length > 0) {
        items.push({ label: 'Recently used', kind: vscode.QuickPickItemKind.Separator }, ...recentTemplates.map(item));
    }
    const groups = new Map<string, DotnetTemplate[]>();
    for (const template of templates) {
        const group = template.tags[0] ?? 'Other';
        groups.set(group, [...(groups.get(group) ?? []), template]);
    }
    for (const [group, groupTemplates] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        items.push({ label: group, kind: vscode.QuickPickItemKind.Separator }, ...groupTemplates.sort((a, b) => a.name.localeCompare(b.name)).map(item));
    }
    const template = (await vscode.window.showQuickPick(items, { placeHolder: 'Add New Project', matchOnDescription: true, matchOnDetail: true }))?.template;
    if (!template) {
        return;
    }

    const projectPaths = [...solution.projects.keys()];
    const existingNames = projectPaths.map(project => path.parse(project).name.toLowerCase());
    const name = await vscode.window.showInputBox({
        prompt: `Name of the new ${template.name} project`, ignoreFocusOut: true,
        validateInput: value => !isValidProjectName(value) ? 'Use letters, digits, _ and .'
            : existingNames.includes(value.toLowerCase()) ? `The solution already has a project ${value}` : undefined,
    });
    if (!name) {
        return;
    }
    const location = await vscode.window.showInputBox({
        prompt: 'Project folder, relative to the solution', value: defaultProjectLocation(solutionDir, projectPaths, name), ignoreFocusOut: true,
        validateInput: value => {
            const dir = path.resolve(solutionDir, value);
            return !value.trim() ? 'Enter a folder'
                : fs.existsSync(dir) && fs.readdirSync(dir).length > 0 ? `${value} exists and is not empty` : undefined;
        },
    });
    if (!location) {
        return;
    }
    const projectDir = path.resolve(solutionDir, location);

    const args = ['new', template.shortNames[0], '-n', name, '-o', projectDir];
    if (template.languages.length > 1 && template.languages.includes('C#')) {
        args.push('--language', 'C#');
    }
    const created = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating ${name}...` },
        async () => {
            const framework = mostCommonFramework(await Promise.all(projectPaths.map(project => DebugConfigService.extractTargetFrameworks(project))));
            if (framework) {
                const help = await dotnet(['new', template.shortNames[0], '-h'], solutionDir);
                if (frameworkChoices(help.output).includes(framework)) {
                    args.push('--framework', framework);
                }
            }
            return dotnet(args, solutionDir);
        });
    const projectFile = findProjectFile(projectDir);
    if (created.code !== 0 || !projectFile) {
        void showFailure(`Creating ${name} from ${template.name} failed.`);
        return;
    }

    await globalState?.update(RECENT_PROJECT_TEMPLATES, [template.shortNames[0], ...recent.filter(t => t !== template.shortNames[0])].slice(0, 5));
    try {
        await solution.addProject(projectFile, solutionFolderPath);
        vscode.window.showInformationMessage(`Added project ${name}`);
    } catch (error) {
        log.error('Adding the new project to the solution failed:', error);
        vscode.window.showErrorMessage(`${name} was created in ${location} but could not be added to the solution: ${error}`);
    }
}
