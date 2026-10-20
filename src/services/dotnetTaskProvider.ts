import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from './solutionService';
import { sln } from '../core/utils';
import { BuildConfiguration } from './buildConfiguration';
import { EMIT_GENERATED_FILES } from './analyzers';
import { Settings } from './settings';
import { solutionWorkspaceFolder } from './workspaceFolders';
import { UnloadedProjects } from './unloadedProjects';
import { platformProperty } from './configurationManager/configurationManager';
import { activeProjectBuild } from './activeBuild';

export const DOTNET_TASK_TYPE = 'shinobi-dotnet';

export type DotnetTaskAction = 'build' | 'rebuild' | 'clean' | 'restore' | 'publish' | 'pack';
/** The actions offered for the solution and every project; publish tasks come from publish profiles, pack is for libraries */
export const DOTNET_TASK_ACTIONS: readonly DotnetTaskAction[] = ['build', 'rebuild', 'clean', 'restore'];

export interface DotnetTaskDefinition extends vscode.TaskDefinition {
    readonly type: typeof DOTNET_TASK_TYPE;
    readonly action: DotnetTaskAction;
    /** Absolute path of the solution or project file */
    readonly target: string;
    /** Debug, Release, ...; the active solution configuration when not set */
    readonly configuration?: string;
    /** Publish profile (Properties/PublishProfiles/<profile>.pubxml), for publish */
    readonly profile?: string;
}

const QUIET = ['-nologo', '-consoleLoggerParameters:NoSummary'];

/**
 * `dotnet` arguments for an action; build output uses full paths so `$msCompile` links resolve, and
 * builds write the source generators' output for Dependencies > Analyzers
 */
export function dotnetTaskArgs(action: DotnetTaskAction, target: string, configuration: string, profile?: string, emitGeneratedFiles = true, platform?: string): string[] {
    const config = ['--configuration', configuration, ...platformProperty(platform)];
    const generated = emitGeneratedFiles ? [EMIT_GENERATED_FILES] : [];
    switch (action) {
        case 'build': return ['build', target, ...config, ...QUIET, '-property:GenerateFullPaths=true', ...generated];
        case 'rebuild': return ['build', target, ...config, '--no-incremental', ...QUIET, '-property:GenerateFullPaths=true', ...generated];
        case 'clean': return ['clean', target, ...config, ...QUIET];
        case 'restore': return ['restore', target];
        case 'pack': return ['pack', target, ...config, ...QUIET, '-property:GenerateFullPaths=true'];
        case 'publish': return ['publish', target, `-property:PublishProfile=${profile}`, ...QUIET, '-property:GenerateFullPaths=true'];
    }
}

/** Creates the task for a definition; the solution build is the default build task (Ctrl+Shift+B) */
export function createDotnetTask(
    definition: DotnetTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope = solutionWorkspaceFolder() ?? vscode.TaskScope.Workspace
): vscode.Task {
    const { action, target } = definition;
    // A solution build applies the solution's mapping itself; a project build ignores the solution, so the mapping is applied here
    const projectBuild = sln(target) ? undefined : activeProjectBuild(target);
    const configuration = definition.configuration ?? projectBuild?.configuration ?? BuildConfiguration.active;
    const platform = projectBuild ? projectBuild.platform : BuildConfiguration.activePlatform;
    const targetName = path.basename(target, sln(target) ?? path.extname(target));
    // Unloaded projects are left out of solution builds through a solution filter
    const buildTarget = sln(target) ? UnloadedProjects.buildTarget(target, SolutionService.getActiveSolution()?.projects.keys() ?? []) : target;
    const task = new vscode.Task(
        definition,
        scope,
        definition.profile ? `${action} ${targetName} (${definition.profile})` : `${action} ${targetName}`,
        DOTNET_TASK_TYPE,
        new vscode.ShellExecution('dotnet', dotnetTaskArgs(action, buildTarget, configuration, definition.profile, Settings.emitGeneratedFiles(), platform), { cwd: path.dirname(target) }),
        action === 'restore' ? [] : ['$msCompile']
    );
    if (action !== 'publish' && action !== 'pack') {
        task.group = action === 'build' && sln(target)
            ? { id: vscode.TaskGroup.Build.id, isDefault: true } as vscode.TaskGroup
            : vscode.TaskGroup.Build;
    }
    return task;
}

function isDotnetTaskDefinition(definition: vscode.TaskDefinition): definition is DotnetTaskDefinition {
    return typeof definition.target === 'string'
        && (DOTNET_TASK_ACTIONS.includes(definition.action) || (definition.action === 'publish' && typeof definition.profile === 'string')
            || definition.action === 'pack');
}

/** Build, rebuild, clean and restore for the active solution and each of its projects */
export class DotnetTaskProvider implements vscode.TaskProvider {
    provideTasks(): vscode.Task[] {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return [];
        }
        const targets = [solution.solutionPath, ...[...solution.projects.keys()].sort()];
        return targets.flatMap(target =>
            DOTNET_TASK_ACTIONS.map(action => createDotnetTask({ type: DOTNET_TASK_TYPE, action, target })));
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        // VS Code requires the resolved task to keep the original definition object
        return isDotnetTaskDefinition(task.definition)
            ? createDotnetTask(task.definition, task.scope as vscode.WorkspaceFolder | vscode.TaskScope | undefined)
            : undefined;
    }
}
