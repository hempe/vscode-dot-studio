import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from './solutionService';
import { sln } from '../core/utils';
import { BuildConfiguration } from './buildConfiguration';
import { EMIT_GENERATED_FILES } from './analyzers';
import { Settings } from './settings';
import { solutionWorkspaceFolder } from './workspaceFolders';

export const DOTNET_TASK_TYPE = 'shinobi-dotnet';

export type DotnetTaskAction = 'build' | 'rebuild' | 'clean' | 'restore' | 'publish';
/** The actions offered for the solution and every project; publish tasks come from publish profiles */
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
export function dotnetTaskArgs(action: DotnetTaskAction, target: string, configuration: string, profile?: string, emitGeneratedFiles = true): string[] {
    const config = ['--configuration', configuration];
    const generated = emitGeneratedFiles ? [EMIT_GENERATED_FILES] : [];
    switch (action) {
        case 'build': return ['build', target, ...config, ...QUIET, '-property:GenerateFullPaths=true', ...generated];
        case 'rebuild': return ['build', target, ...config, '--no-incremental', ...QUIET, '-property:GenerateFullPaths=true', ...generated];
        case 'clean': return ['clean', target, ...config, ...QUIET];
        case 'restore': return ['restore', target];
        case 'publish': return ['publish', target, `-property:PublishProfile=${profile}`, ...QUIET, '-property:GenerateFullPaths=true'];
    }
}

/** Creates the task for a definition; the solution build is the default build task (Ctrl+Shift+B) */
export function createDotnetTask(
    definition: DotnetTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope = solutionWorkspaceFolder() ?? vscode.TaskScope.Workspace
): vscode.Task {
    const { action, target } = definition;
    const configuration = definition.configuration ?? BuildConfiguration.active;
    const targetName = path.basename(target, sln(target) ?? path.extname(target));
    const task = new vscode.Task(
        definition,
        scope,
        definition.profile ? `${action} ${targetName} (${definition.profile})` : `${action} ${targetName}`,
        DOTNET_TASK_TYPE,
        new vscode.ShellExecution('dotnet', dotnetTaskArgs(action, target, configuration, definition.profile, Settings.emitGeneratedFiles()), { cwd: path.dirname(target) }),
        action === 'restore' ? [] : ['$msCompile']
    );
    if (action !== 'publish') {
        task.group = action === 'build' && sln(target)
            ? { id: vscode.TaskGroup.Build.id, isDefault: true } as vscode.TaskGroup
            : vscode.TaskGroup.Build;
    }
    return task;
}

function isDotnetTaskDefinition(definition: vscode.TaskDefinition): definition is DotnetTaskDefinition {
    return typeof definition.target === 'string'
        && (DOTNET_TASK_ACTIONS.includes(definition.action) || (definition.action === 'publish' && typeof definition.profile === 'string'));
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
