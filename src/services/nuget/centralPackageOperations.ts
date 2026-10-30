import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solution/solutionService';
import { ProjectItemsService } from '../project/items/projectItemsService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageOperationResult } from './types';
import { centralFiles } from './centralPackages';
import { applyPackageEdits, declaredGlobals, importChain } from './centralPackageFiles';
import { PackageEdit } from './centralPackageEdits';
import { changesOnlyItself, findVersionProperties, propertyEdit, propertyQuestion } from './versionProperties';
import { pathKey } from '../project/items/projectItems';
import {
    ProjectState, VersionChangePlan, VersionScope, confirmationText, consolidationText, globalUninstallEdits, planConsolidate, planUninstall,
    planVersionChange,
} from './centralPackagePlan';

const log = logger('CentralPackages');

/** What the operations need from VS Code, the CLI and the solution; replaced in tests */
export interface OperationsHost {
    /** A modal question; the chosen button, or undefined for Cancel */
    ask(message: string, detail: string, ...buttons: string[]): Promise<string | undefined>;
    /** The projects of the solution (and the given ones) with their evaluated packages */
    states(include: readonly string[]): Promise<ProjectState[]>;
    /** `dotnet add package` without its restore: `afterEdits` restores once for all the projects it changed */
    install(projectPath: string, id: string, version: string): Promise<PackageOperationResult>;
    uninstall(projectPath: string, id: string): Promise<PackageOperationResult>;
    restore(target: string): Promise<PackageOperationResult>;
    solutionPath(): string | undefined;
    /** Evaluates the projects again after their files or props files changed (the tree and the NuGet editor follow) */
    reevaluate(projectPaths: readonly string[]): Promise<void>;
}

export interface OperationOutcome {
    /** The user cancelled the confirmation: nothing was changed */
    readonly cancelled: boolean;
    readonly results: PackageOperationResult[];
}

/** The open solution's projects, each evaluated once (from the cache when the tree did it already) */
export async function solutionProjectStates(include: readonly string[] = []): Promise<ProjectState[]> {
    const projects = [...(SolutionService.getActiveSolution()?.projects.values() ?? [])];
    await Promise.all(projects.map(project => project.evaluateItems()));
    const states: ProjectState[] = projects.map(project => ({
        name: project.name, path: project.projectPath, packages: ProjectItemsService.instance.packages(project.projectPath),
    }));
    // A project the NuGet editor was opened for that is not in the solution
    for (const projectPath of include.filter(candidate => !states.some(state => state.path === candidate))) {
        states.push({
            name: path.basename(projectPath, path.extname(projectPath)), path: projectPath,
            packages: await ProjectItemsService.instance.evaluatePackages(projectPath),
        });
    }
    return states;
}

export const vscodeHost: OperationsHost = {
    ask: (message, detail, ...buttons) => Promise.resolve(vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons)),
    states: solutionProjectStates,
    install: (projectPath, id, version) => PackageOperationsService.installPackage({ packageId: id, version, projectPath, noRestore: true }),
    uninstall: (projectPath, id) => PackageOperationsService.uninstallPackage(projectPath, id),
    restore: target => PackageOperationsService.restorePackages(target),
    solutionPath: () => SolutionService.getActiveSolution()?.solutionPath,
    reevaluate: async projectPaths => {
        const solution = SolutionService.getActiveSolution();
        await Promise.all(projectPaths.map(async projectPath => {
            const project = solution?.getProject(projectPath);
            if (project) {
                await project.reevaluateItems();
            } else {
                ProjectItemsService.instance.invalidate(projectPath);
                await ProjectItemsService.instance.evaluate(projectPath);
            }
        }));
    },
};

const isProjectFile = (file: string) => /\.(cs|vb|fs)proj$/i.test(file);
const same = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));
/** Whether a props file reaches the project: MSBuild finds Directory.*.props files in the project's folder and above */
const reaches = (propsFile: string, projectPath: string) => {
    const relative = path.relative(path.dirname(propsFile), path.dirname(projectPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const propertyFiles = (edits: readonly PackageEdit[]) => edits.filter(edit => edit.kind === 'setVersionProperty').map(edit => edit.file);
const readText = (file: string) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
};

/**
 * Versions written as `$(Property)`: the property's definition is changed instead of writing a literal over the
 * reference; asked first when other packages follow the property or it cannot be changed (then the package can get a
 * literal version alone). One answer per property. Undefined: the user cancelled.
 */
async function resolveVersionProperties(edits: readonly PackageEdit[], states: readonly ProjectState[], host: OperationsHost): Promise<PackageEdit[] | undefined> {
    const found = findVersionProperties(edits, states, readText, importChain);
    const answers = new Map<string, boolean>();
    const result: PackageEdit[] = [];
    const add = (edit: PackageEdit) => {
        const key = (candidate: PackageEdit) => `${candidate.kind}|${pathKey(path.normalize(candidate.file))}|${('id' in candidate ? candidate.id : candidate.property).toLowerCase()}`;
        if (!result.some(other => key(other) === key(edit))) {
            result.push(edit);
        }
    };
    for (const edit of edits) {
        const entry = found.find(candidate => candidate.edit === edit);
        if (!entry) {
            add(edit);
            continue;
        }
        const answerKey = `${entry.definition ?? entry.edit.id}|${entry.property}`.toLowerCase();
        let change = changesOnlyItself(entry) || answers.get(answerKey);
        if (change === undefined) {
            const question = propertyQuestion(entry);
            const choice = await host.ask(question.message, question.detail, ...(question.change ? [question.change] : []), question.only);
            if (!choice) {
                return undefined;
            }
            change = choice === question.change;
            answers.set(answerKey, change);
        }
        add(change ? propertyEdit(entry) : edit);
    }
    return result;
}

/**
 * After edits: restore, and evaluate the projects whose files or props files changed, those the CLI updated (`cliUpdated`,
 * which did not restore) and those below a file whose version property changed (`propertyFiles`).
 * One restore for everything: the whole solution when a props file changed (it reaches every project below it) or when
 * more than one project changed, else the one project. Restoring after each project's own edit restored the projects
 * they reference again each time.
 */
async function afterEdits(
    changed: readonly string[], states: readonly ProjectState[], host: OperationsHost, cliUpdated: readonly string[] = [],
    propertyFiles: readonly string[] = [],
): Promise<PackageOperationResult[]> {
    if (changed.length === 0 && cliUpdated.length === 0) {
        return [];
    }
    const propsChanged = changed.filter(file => !isProjectFile(file));
    const affected = changed.length === 0 ? [] : states.filter(state => changed.some(file => same(file, state.path))
        || (!!state.packages && centralFiles(state.packages).some(file => propsChanged.some(changedFile => same(file, changedFile))))
        // A property used as a version is read by every project below its file (Directory.Build.props is no central file)
        || propertyFiles.some(file => reaches(file, state.path)));
    const evaluate = affected.map(state => state.path);
    const projects = [...evaluate, ...new Set(cliUpdated.filter(projectPath => !evaluate.some(candidate => same(candidate, projectPath))))];
    const solutionPath = host.solutionPath();
    const targets = solutionPath && (propsChanged.length > 0 || projects.length > 1) ? [solutionPath] : projects;
    const results: PackageOperationResult[] = [];
    for (const target of targets) {
        results.push(await host.restore(target));
    }
    await host.reevaluate(projects);
    return results;
}

async function apply(edits: Parameters<typeof applyPackageEdits>[0]): Promise<{ changed: string[]; result?: PackageOperationResult }> {
    try {
        return { changed: await applyPackageEdits(edits) };
    } catch (error) {
        log.error('Could not edit the package versions:', error);
        return { changed: [], result: { success: false, message: `Could not edit the package versions: ${error instanceof Error ? error.message : error}` } };
    }
}

/**
 * Install or update packages (one entry per package, with the projects it is for). Central versions are edited once
 * per package; when that reaches projects that were not selected, one confirmation lists them, with "Set for this
 * project only" as the alternative. Projects without CPM go through `dotnet add package` as before.
 */
export async function changePackageVersions(
    changes: readonly { id: string; version: string; projects: readonly string[] }[], scope: VersionScope = 'shared', host: OperationsHost = vscodeHost,
): Promise<OperationOutcome> {
    const states = await host.states([...new Set(changes.flatMap(change => change.projects))]);
    // Global packages written in the props files: a package every project opted out of shows in no evaluation
    const written = (packages: { propsPath?: string }) => packages.propsPath ? declaredGlobals(importChain(packages.propsPath)) : [];
    const plan = (chosen: VersionScope) => changes.map(change => planVersionChange(change.id, change.version, change.projects, states, chosen, written));
    let plans: VersionChangePlan[] = plan(scope);

    const question = confirmationText(plans);
    if (question) {
        const selectedCount = new Set(changes.flatMap(change => change.projects)).size;
        const onlyThese = selectedCount === 1 ? 'Set for This Project Only' : 'Set for the Selected Projects Only';
        const canOverride = scope === 'shared' && plans.every(candidate => candidate.alsoChanges.length === 0 || candidate.canOverride);
        const choice = await host.ask(question.message, question.detail, 'Update All Projects', ...(canOverride ? [onlyThese] : []));
        if (!choice) {
            return { cancelled: true, results: [] };
        }
        if (choice === onlyThese) {
            plans = plan('project');
        }
    }

    const edits = await resolveVersionProperties(plans.flatMap(candidate => candidate.edits), states, host);
    if (!edits) {
        return { cancelled: true, results: [] };
    }
    const results: PackageOperationResult[] = [];
    // Projects `dotnet add package` changed: evaluated again with the edited ones
    const cliUpdated: string[] = [];
    const { changed, result } = await apply(edits);
    if (result) {
        return { cancelled: false, results: [result] };
    }
    for (const candidate of plans) {
        if (candidate.edits.length > 0) {
            results.push({ success: true, message: `${candidate.id} ${candidate.version}`, packageId: candidate.id, version: candidate.version });
        }
        for (const projectPath of candidate.cliProjects) {
            const installed = await host.install(projectPath, candidate.id, candidate.version);
            results.push(installed);
            if (installed.success) {
                cliUpdated.push(projectPath);
            }
        }
    }
    results.push(...(await afterEdits(changed, states, host, cliUpdated, propertyFiles(edits))).filter(restore => !restore.success));
    return { cancelled: false, results };
}

/**
 * Uninstall a package from the selected projects. A global package is removed for all projects or opted out for the
 * selected ones (the question names every project it applies to); a central version no project uses afterwards is
 * removed only when the user says so.
 */
export async function uninstallPackages(id: string, projects: readonly string[], host: OperationsHost = vscodeHost): Promise<OperationOutcome> {
    const states = await host.states(projects);
    const plan = planUninstall(id, projects, states);
    const results: PackageOperationResult[] = [];
    const changed: string[] = [];

    if (plan.global) {
        const onlyThese = plan.global.selected.length === 1 ? 'Remove from This Project Only' : 'Remove from the Selected Projects Only';
        const choice = await host.ask(
            `${id} is a global package: every project gets it from ${path.basename(plan.global.file)}.`,
            `It applies to ${plan.global.appliesTo.join(', ')}. Remove it for all of them, or only for the selected project${plan.global.selected.length === 1 ? '' : 's'} (a GlobalPackageReference Remove in the project file)?`,
            'Remove for All Projects', onlyThese);
        if (!choice && plan.cliProjects.length === 0) {
            return { cancelled: true, results: [] };
        }
        if (choice) {
            const applied = await apply(globalUninstallEdits(plan, choice === onlyThese ? 'selected' : 'all', states));
            changed.push(...applied.changed);
            results.push(applied.result ?? { success: true, message: `Removed ${id}`, packageId: id });
        }
    }

    const removed: string[] = [];
    for (const projectPath of plan.cliProjects) {
        const result = await host.uninstall(projectPath, id);
        results.push(result);
        if (result.success) {
            removed.push(projectPath);
        }
    }

    // Only when every removal worked: otherwise a project still uses the version
    if (removed.length === plan.cliProjects.length) {
        for (const orphan of plan.orphanedVersions) {
            const choice = await host.ask(`No project uses ${orphan.id} any more. Remove its version from ${path.basename(orphan.file)}?`,
                `The PackageVersion entry is unused now; keep it if a project outside this solution uses it.`, 'Remove');
            if (choice === 'Remove') {
                const applied = await apply([{ kind: 'removePackageVersion', file: orphan.file, id: orphan.id }]);
                changed.push(...applied.changed);
                if (applied.result) {
                    results.push(applied.result);
                }
            }
        }
    }

    results.push(...(await afterEdits(changed, states, host)).filter(restore => !restore.success));
    await host.reevaluate(removed.filter(projectPath => !changed.includes(projectPath)));
    return { cancelled: false, results };
}

/**
 * Consolidate packages to one version each across the solution. Under CPM that sets the central (or global) version
 * and removes the VersionOverrides, after one confirmation listing what changes; projects without CPM are updated
 * with `dotnet add package --version`.
 */
export async function consolidatePackages(changes: readonly { id: string; version: string }[], host: OperationsHost = vscodeHost): Promise<OperationOutcome> {
    const states = await host.states([]);
    const plans = changes.map(change => planConsolidate(change.id, change.version, states));
    const question = consolidationText(plans);
    if (question && await host.ask(question.message, question.detail, 'Consolidate') !== 'Consolidate') {
        return { cancelled: true, results: [] };
    }
    const edits = await resolveVersionProperties(plans.flatMap(plan => plan.edits), states, host);
    if (!edits) {
        return { cancelled: true, results: [] };
    }
    const { changed, result } = await apply(edits);
    if (result) {
        return { cancelled: false, results: [result] };
    }
    const results: PackageOperationResult[] = [];
    const cliUpdated: string[] = [];
    for (const plan of plans) {
        if (plan.edits.length > 0) {
            results.push({ success: true, message: `${plan.id} ${plan.version}`, packageId: plan.id, version: plan.version });
        }
        for (const projectPath of plan.cliProjects) {
            const installed = await host.install(projectPath, plan.id, plan.version);
            results.push(installed);
            if (installed.success) {
                cliUpdated.push(projectPath);
            }
        }
        if (plan.edits.length === 0 && plan.cliProjects.length === 0) {
            results.push({ success: true, message: `${plan.id} is already at ${plan.version} in all projects`, packageId: plan.id });
        }
    }
    results.push(...(await afterEdits(changed, states, host, cliUpdated, propertyFiles(edits))).filter(restore => !restore.success));
    return { cancelled: false, results };
}
