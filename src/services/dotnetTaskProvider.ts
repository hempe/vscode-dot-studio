import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from './solutionService';
import { sln } from '../core/utils';

export const DOTNET_TASK_TYPE = 'shinobi-dotnet';

export type DotnetTaskAction = 'build' | 'rebuild' | 'clean' | 'restore';
export const DOTNET_TASK_ACTIONS: readonly DotnetTaskAction[] = ['build', 'rebuild', 'clean', 'restore'];

export interface DotnetTaskDefinition extends vscode.TaskDefinition {
    readonly type: typeof DOTNET_TASK_TYPE;
    readonly action: DotnetTaskAction;
    /** Absolute path of the solution or project file */
    readonly target: string;
}

const QUIET = ['-nologo', '-consoleLoggerParameters:NoSummary'];

/** `dotnet` arguments for an action; build output uses full paths so `$msCompile` links resolve */
export function dotnetTaskArgs(action: DotnetTaskAction, target: string): string[] {
    switch (action) {
        case 'build': return ['build', target, ...QUIET, '-property:GenerateFullPaths=true'];
        case 'rebuild': return ['build', target, '--no-incremental', ...QUIET, '-property:GenerateFullPaths=true'];
        case 'clean': return ['clean', target, ...QUIET];
        case 'restore': return ['restore', target];
    }
}

/** Creates the task for a definition; the solution build is the default build task (Ctrl+Shift+B) */
export function createDotnetTask(
    definition: DotnetTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace
): vscode.Task {
    const { action, target } = definition;
    const targetName = path.basename(target, sln(target) ?? path.extname(target));
    const task = new vscode.Task(
        definition,
        scope,
        `${action} ${targetName}`,
        DOTNET_TASK_TYPE,
        new vscode.ShellExecution('dotnet', dotnetTaskArgs(action, target), { cwd: path.dirname(target) }),
        action === 'restore' ? [] : ['$msCompile']
    );
    task.group = action === 'build' && sln(target)
        ? { id: vscode.TaskGroup.Build.id, isDefault: true } as vscode.TaskGroup
        : vscode.TaskGroup.Build;
    return task;
}

function isDotnetTaskDefinition(definition: vscode.TaskDefinition): definition is DotnetTaskDefinition {
    return DOTNET_TASK_ACTIONS.includes(definition.action) && typeof definition.target === 'string';
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
