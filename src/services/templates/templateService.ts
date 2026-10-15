import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NamespaceService } from '../namespaceService';
import { DebugConfigService } from '../debugConfigService';
import { TemplateInfo, WizardInit, WizardTemplate } from '../../types/templateWizard';
import { optionArgs, readTemplates } from './templateCache';
import { BUILTIN_ITEMS, builtinItemContent, itemBaseName, projectLanguage, replaceNamespace } from './itemTemplates';
import { defaultProjectLocation, findProjectFile, isValidProjectName, mostCommonFramework, solutionLayout } from './newProject';

const log = logger('Templates');
const RECENT_PROJECT_TEMPLATES = 'shinobi.recentProjectTemplates';
const BUILTIN_PREFIX = 'builtin:';

let globalState: vscode.Memento | undefined;
let output: vscode.OutputChannel | undefined;

/** Called on activation: recently used project templates are kept per user */
export function initializeTemplates(state: vscode.Memento): void {
    globalState = state;
}

function outputChannel(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET: Templates');
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

/** The first lines of dotnet's output, for the error shown in the wizard */
function failure(what: string, result: { output: string }): string {
    const details = result.output.split(/\r?\n/).filter(line => line.trim()).slice(0, 6).join('\n');
    return `${what} failed${details ? `:\n${details}` : '.'}`;
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

function wizardTemplate(template: TemplateInfo, recent = false): WizardTemplate {
    return {
        id: template.identity,
        name: template.name,
        shortName: template.shortName,
        description: template.description,
        language: template.language,
        tags: template.tags,
        recent,
        defaultName: template.defaultName ?? template.name.replace(/[^A-Za-z0-9]/g, ''),
        needsName: !!template.language,
        options: template.options,
    };
}

/** One template per short name: the C# one where there are several languages */
function preferLanguage(templates: TemplateInfo[], language: string): TemplateInfo[] {
    const byShortName = new Map<string, TemplateInfo>();
    for (const template of templates) {
        const current = byShortName.get(template.shortName);
        if (!current || (current.language !== language && template.language === language)) {
            byShortName.set(template.shortName, template);
        }
    }
    return [...byShortName.values()];
}

let cachedTemplates: TemplateInfo[] = [];

async function templates(): Promise<TemplateInfo[]> {
    cachedTemplates = await readTemplates();
    return cachedTemplates;
}

/** Data for the Add New Project wizard */
export async function newProjectWizard(solutionFolderPath?: string): Promise<WizardInit> {
    const solution = SolutionService.getActiveSolution();
    const solutionDir = solution ? path.dirname(solution.solutionPath) : '';
    const projectPaths = [...(solution?.projects.keys() ?? [])];
    const recent = globalState?.get<string[]>(RECENT_PROJECT_TEMPLATES) ?? [];

    const projectTemplates = preferLanguage((await templates()).filter(t => t.type === 'project'), 'C#')
        .map(template => wizardTemplate(template, recent.includes(template.identity)))
        .sort((a, b) => (recent.indexOf(a.id) + 1 || Infinity) - (recent.indexOf(b.id) + 1 || Infinity) || a.name.localeCompare(b.name));

    const framework = mostCommonFramework(await Promise.all(projectPaths.map(project => DebugConfigService.extractTargetFrameworks(project))));
    return {
        kind: 'project',
        title: solutionFolderPath ? `Add New Project to ${solutionFolderPath}` : 'Add New Project',
        templates: projectTemplates,
        location: defaultProjectLocation(solutionDir, projectPaths, ''),
        preferredValues: framework ? { framework } : {},
    };
}

/** Data for "Create a New Project": a new solution, in the opened folder or the home folder */
export async function newSolutionWizard(): Promise<WizardInit> {
    const recent = globalState?.get<string[]>(RECENT_PROJECT_TEMPLATES) ?? [];
    const projectTemplates = preferLanguage((await templates()).filter(t => t.type === 'project'), 'C#')
        .map(template => wizardTemplate(template, recent.includes(template.identity)))
        .sort((a, b) => (recent.indexOf(a.id) + 1 || Infinity) - (recent.indexOf(b.id) + 1 || Infinity) || a.name.localeCompare(b.name));
    return {
        kind: 'project',
        title: 'Create a New Project',
        templates: projectTemplates,
        location: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        preferredValues: {},
        newSolution: true,
    };
}

/** Creates the solution of "Create a New Project" and opens it: here if it is in the opened folder, else its folder */
export async function createNewSolution(
    request: { templateId: string; name: string; location?: string; solutionName?: string; sameDirectory?: boolean; values: Record<string, string | boolean> }
): Promise<string | undefined> {
    const template = cachedTemplates.find(t => t.identity === request.templateId);
    if (!template || !request.location) {
        return 'No template or location.';
    }
    const result = await createSolutionWithProject(template, request.name.trim(), request.location, request.solutionName ?? request.name, !!request.sameDirectory, request.values);
    if (!result.solutionPath) {
        return result.error;
    }
    const recent = globalState?.get<string[]>(RECENT_PROJECT_TEMPLATES) ?? [];
    await globalState?.update(RECENT_PROJECT_TEMPLATES, [template.identity, ...recent.filter(id => id !== template.identity)].slice(0, 5));

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const relative = workspace ? path.relative(workspace, result.solutionPath) : '..';
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        await SolutionService.openSolution(result.solutionPath);
        await vscode.commands.executeCommand('shinobi.internal.refreshSolution');
    } else {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path.dirname(result.solutionPath)));
    }
    return undefined;
}

/** Data for the Add New Item wizard for `folder` of `projectPath` */
export async function newItemWizard(folder: string, projectPath: string): Promise<WizardInit> {
    const language = projectLanguage(projectPath);
    const builtins: WizardTemplate[] = language === 'C#'
        ? BUILTIN_ITEMS.map(item => ({
            id: `${BUILTIN_PREFIX}${item.kind}`, name: item.label, description: `An empty ${item.kind}`, language: 'C#',
            tags: ['Code'], defaultName: item.defaultName, needsName: true, options: [],
        }))
        : [];
    const builtinKinds = new Set<string>(BUILTIN_ITEMS.map(item => item.kind));
    const itemTemplates = (await templates())
        .filter(t => t.type === 'item' && (!t.language || t.language === language) && !builtinKinds.has(t.shortName))
        .map(template => wizardTemplate(template))
        .sort((a, b) => a.name.localeCompare(b.name));

    const namespace = await NamespaceService.calculateExpectedNamespace(path.join(folder, 'File.cs'), projectPath);
    return {
        kind: 'item',
        title: `Add New Item to ${path.relative(path.dirname(path.dirname(projectPath)), folder) || path.basename(folder)}`,
        templates: [...builtins, ...itemTemplates],
        location: folder,
        preferredValues: namespace ? { namespace } : {},
    };
}

/** Creates the project and adds it to the solution (folder); returns an error message for the wizard */
export async function createProject(
    templateId: string, name: string, location: string, values: Record<string, string | boolean>, solutionFolderPath?: string
): Promise<string | undefined> {
    const solution = SolutionService.getActiveSolution();
    const template = cachedTemplates.find(t => t.identity === templateId);
    if (!solution || !template) {
        return 'No solution or template.';
    }
    const solutionDir = path.dirname(solution.solutionPath);
    if (!isValidProjectName(name)) {
        return `'${name}' is not a valid project name: use letters, digits, _ and .`;
    }
    if ([...solution.projects.keys()].some(project => path.parse(project).name.toLowerCase() === name.toLowerCase())) {
        return `The solution already has a project ${name}.`;
    }
    const projectDir = path.resolve(solutionDir, location);
    if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
        return `${location} exists and is not empty.`;
    }

    const args = ['new', template.shortName, '-n', name, '-o', projectDir, ...optionArgs(template.options, values)];
    if (template.language) {
        args.push('--language', template.language);
    }
    const result = await dotnet(args, solutionDir);
    const projectFile = findProjectFile(projectDir);
    if (result.code !== 0 || !projectFile) {
        return failure(`Creating ${name}`, result);
    }

    const recent = globalState?.get<string[]>(RECENT_PROJECT_TEMPLATES) ?? [];
    await globalState?.update(RECENT_PROJECT_TEMPLATES, [template.identity, ...recent.filter(id => id !== template.identity)].slice(0, 5));
    try {
        await solution.addProject(projectFile, solutionFolderPath);
    } catch (error) {
        log.error('Adding the new project to the solution failed:', error);
        return `${name} was created in ${location} but could not be added to the solution: ${error}`;
    }
    return undefined;
}

/**
 * Visual Studio's "Create a new project": a new solution (.slnx; .sln with SDKs before 9.0.200) with the
 * project from the template in it. Returns the solution file, or an error message for the wizard.
 */
export async function createSolutionWithProject(
    template: TemplateInfo, name: string, location: string, solutionName: string, sameDirectory: boolean, values: Record<string, string | boolean>
): Promise<{ error?: string; solutionPath?: string }> {
    if (!isValidProjectName(name)) {
        return { error: `'${name}' is not a valid project name: use letters, digits, _ and .` };
    }
    if (!sameDirectory && (!solutionName.trim() || /[\\/:*?"<>|]/.test(solutionName))) {
        return { error: `'${solutionName}' is not a valid solution name.` };
    }
    const { solutionDir, projectDir } = solutionLayout(location, name, solutionName.trim() || name, sameDirectory);
    if (fs.existsSync(solutionDir) && fs.readdirSync(solutionDir).length > 0) {
        return { error: `${solutionDir} exists and is not empty.` };
    }
    fs.mkdirSync(solutionDir, { recursive: true });

    const slnName = sameDirectory ? name : solutionName.trim();
    let created = await dotnet(['new', 'sln', '-n', slnName, '-o', solutionDir, '--format', 'slnx'], solutionDir);
    if (created.code !== 0) {
        created = await dotnet(['new', 'sln', '-n', slnName, '-o', solutionDir], solutionDir);
    }
    const solutionPath = [`${slnName}.slnx`, `${slnName}.sln`].map(file => path.join(solutionDir, file)).find(file => fs.existsSync(file));
    if (created.code !== 0 || !solutionPath) {
        return { error: failure('Creating the solution', created) };
    }

    const args = ['new', template.shortName, '-n', name, '-o', projectDir, ...optionArgs(template.options, values)];
    if (template.language) {
        args.push('--language', template.language);
    }
    const result = await dotnet(args, solutionDir);
    const projectFile = findProjectFile(projectDir);
    if (result.code !== 0 || !projectFile) {
        return { error: failure(`Creating ${name}`, result) };
    }
    const added = await dotnet(['sln', solutionPath, 'add', projectFile], solutionDir);
    if (added.code !== 0) {
        return { error: failure(`Adding ${name} to ${path.basename(solutionPath)}`, added) };
    }
    return { solutionPath };
}

/** All files below `folder` (readdir's `recursive` needs Node 20, older VS Code versions run Node 16/18) */
function listFiles(folder: string): string[] {
    if (!fs.existsSync(folder)) {
        return [];
    }
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(folder, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : entry.isFile() ? [entryPath] : [];
    });
}

/**
 * Creates the item in `folder`. Built-in items are written directly; `dotnet new` templates run in the folder,
 * and their C# files get the folder's namespace unless the template took one.
 */
export async function createItem(
    templateId: string, folder: string, name: string, projectPath: string, values: Record<string, string | boolean>
): Promise<{ file?: string; error?: string }> {
    if (templateId.startsWith(BUILTIN_PREFIX)) {
        const kind = BUILTIN_ITEMS.find(item => `${BUILTIN_PREFIX}${item.kind}` === templateId)!.kind;
        const fileName = /\.cs$/i.test(name) ? name : `${name}.cs`;
        const filePath = path.join(folder, fileName);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(path.parse(fileName).name)) {
            return { error: `'${path.parse(fileName).name}' is not a valid type name.` };
        }
        if (fs.existsSync(filePath)) {
            return { error: `${fileName} already exists.` };
        }
        const namespace = await NamespaceService.calculateExpectedNamespace(filePath, projectPath) ?? path.parse(projectPath).name;
        await fs.promises.writeFile(filePath, builtinItemContent(kind, path.parse(fileName).name, namespace));
        return { file: filePath };
    }

    const template = cachedTemplates.find(t => t.identity === templateId);
    if (!template) {
        return { error: 'Unknown template.' };
    }
    const before = new Set(listFiles(folder));
    const args = ['new', template.shortName, '-o', folder, ...optionArgs(template.options, values)];
    if (template.language) {
        args.push('-n', itemBaseName(name), '--language', template.language);
    }
    const result = await dotnet(args, folder);
    if (result.code !== 0) {
        return { error: failure(`Adding ${template.name}`, result) };
    }

    const created = listFiles(folder).filter(file => !before.has(file));
    if (!template.options.some(option => option.name === 'namespace')) {
        for (const file of created.filter(file => file.endsWith('.cs'))) {
            const namespace = await NamespaceService.calculateExpectedNamespace(file, projectPath);
            if (namespace) {
                await fs.promises.writeFile(file, replaceNamespace(await fs.promises.readFile(file, 'utf8'), namespace));
            }
        }
    }
    return { file: created.find(file => /\.(razor|cshtml)$/i.test(file)) ?? created.find(file => file.endsWith('.cs')) ?? created[0] };
}
