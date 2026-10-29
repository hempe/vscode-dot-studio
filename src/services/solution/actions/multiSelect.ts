import * as vscode from 'vscode';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NodeIdService } from '../nodeIdService';
import { ProjectActionCmd } from '../../types/commands/project-action';
import { NodeIdString } from '../../types/nodeId';
import { createDotnetTask, DOTNET_TASK_TYPE } from '../dotnetTaskProvider';
import { runTask } from '../runTask';
import { multiDeleteQuestion } from '../projectItems/linkedItems';
import { clipboard, projectsLinking } from './fileActions';
import { removeDependencyFromCsproj } from './referenceActions';

const log = logger('multiSelect');

/**
 * Commands of Visual Studio's multi-select: they act on all selected nodes of the kinds that offer them,
 * asking once. Other commands act on the clicked node only.
 */
export const multiSelectActions: readonly ProjectActionCmd['action'][] = [
    'deleteFile', 'removeProject', 'removeSolutionItem', 'removeDependency', 'copy', 'cut', 'build', 'rebuild', 'clean',
];

export async function handleMultiAction(action: ProjectActionCmd['action'], nodeIdStrings: readonly NodeIdString[]): Promise<void> {
    const nodes = nodeIdStrings.map(id => NodeIdService.parse(id));
    const confirm = async (question: string, button: string) =>
        await vscode.window.showWarningMessage(question, { modal: true }, button) === button;
    const solution = SolutionService.getActiveSolution();
    try {
        switch (action) {
            case 'deleteFile':
                if (await confirm(multiDeleteQuestion(nodes.length,
                    nodes.filter(node => node.type === 'file' && projectsLinking(node.path).length > 0).map(node => node.path)), 'Delete')) {
                    for (const node of nodes) {
                        await vscode.workspace.fs.delete(vscode.Uri.file(node.path), { recursive: true, useTrash: true });
                    }
                }
                break;
            case 'removeProject':
                if (solution && await confirm(`Remove ${nodes.length} projects from the solution? Their files stay on disk.`, 'Remove')) {
                    for (const node of nodes) {
                        await solution.removeProject(node.path);
                    }
                }
                break;
            case 'removeSolutionItem':
                if (solution && await confirm(`Remove ${nodes.length} items from the solution? The files stay on disk.`, 'Remove')) {
                    for (const node of nodes) {
                        await solution.removeSolutionItem(node.path);
                    }
                }
                break;
            case 'removeDependency':
                if (await confirm(`Remove ${nodes.length} references from their projects?`, 'Remove')) {
                    for (const node of nodes) {
                        const info = NodeIdService.getDependencyInfoFromNode(node);
                        if (info) {
                            await removeDependencyFromCsproj(info.projectPath, info.dependencyType, info.dependencyName);
                        }
                    }
                }
                break;
            case 'copy':
            case 'cut':
                clipboard.current = { paths: nodes.map(node => node.path), operation: action };
                break;
            case 'build':
            case 'rebuild':
            case 'clean':
                // One after the other, like Visual Studio's Build Selection
                for (const node of nodes) {
                    const exitCode = await runTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action, target: node.path }));
                    if (exitCode !== 0) {
                        break;
                    }
                }
                break;
            default:
                log.warn(`${action} has no multi-select variant`);
        }
    } catch (error) {
        log.error(`${action} on ${nodes.length} nodes failed:`, error);
        vscode.window.showErrorMessage(`${action} failed: ${error instanceof Error ? error.message : error}`);
    }
}
