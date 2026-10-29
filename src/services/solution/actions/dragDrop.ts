import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NodeIdService } from '../nodeIdService';
import { updateNamespacesAfterMove } from '../namespaceAfterMove';
import { canDrop, DropNode } from '../../core/dropRules';
import { solutionDropNode } from '../solutionDropNodes';
import { NodeIdString } from '../../types/nodeId';
import type { DropResult } from '../solutionExpansionService';
import { pasteOne } from './fileActions';
import { addDroppedReferences } from './referenceActions';

const log = logger('dragDrop');

/**
 * Drag & drop in the tree. Checks the drop again (the webview is not trusted: the rule nodes are made from the
 * solution, and an id it does not have refuses the drop), then moves or copies files and folders through the paste
 * path, with one namespace question for what was moved, and moves projects, solution folders and solution items in
 * the solution file. Returns where the drop went and what it moved or copied (undefined: nothing), so the tree
 * can open the target and select them.
 */
export async function moveNodes(nodeIdStrings: readonly NodeIdString[], targetNodeIdString: NodeIdString, copy: boolean): Promise<DropResult | undefined> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        return undefined;
    }
    const target = solutionDropNode(solution, targetNodeIdString);
    const dragged = nodeIdStrings.map(id => solutionDropNode(solution, id));
    const known = dragged.filter((node): node is DropNode => !!node);
    const verdict = target && known.length === dragged.length ? canDrop(known, target, copy) : undefined;
    if (!verdict?.container || verdict.nodes.length === 0) {
        log.info(`Drop of ${nodeIdStrings.length} node(s) refused`);
        vscode.window.showWarningMessage('The items cannot be dropped there.');
        return undefined;
    }
    if (verdict.effect === 'link') {
        await addDroppedReferences(NodeIdService.parse(verdict.container.nodeId).path, verdict.nodes.map(node => NodeIdService.parse(node.nodeId).path));
        return undefined;
    }
    const dropped: DropResult['nodes'][number][] = [];
    try {
        const container = NodeIdService.parse(verdict.container.nodeId);
        const files = verdict.nodes.filter(node => node.type === 'file' || node.type === 'folder');
        if (files.length > 0) {
            const directory = container.type === 'project' ? path.dirname(container.path) : container.path;
            const operation = verdict.effect === 'copy' ? 'copy' : 'cut';
            const moved: string[] = [];
            for (const node of files) {
                const destination = await pasteOne(NodeIdService.parse(node.nodeId).path, directory, operation);
                if (destination) {
                    dropped.push({ type: node.type, key: destination });
                }
                if (destination && operation === 'cut') {
                    moved.push(destination);
                }
            }
            await updateNamespacesAfterMove(moved, 'Moved');
        }
        const targetFolderGuid = container.type === 'solutionFolder' ? container.guid : undefined;
        for (const node of verdict.nodes) {
            const id = NodeIdService.parse(node.nodeId);
            if (id.type === 'project') {
                await solution.moveToSolutionFolder({ kind: 'project', projectPath: id.path }, targetFolderGuid);
                dropped.push({ type: 'project', key: id.path });
            } else if (id.type === 'solutionFolder') {
                await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: id.guid }, targetFolderGuid);
                dropped.push({ type: 'solutionFolder', key: id.name });
            } else if (id.type === 'solutionItem') {
                await solution.moveToSolutionFolder({ kind: 'solutionItem', filePath: id.path, folderGuid: id.guid }, targetFolderGuid);
                dropped.push({ type: 'solutionItem', key: id.path });
            }
        }
    } catch (error) {
        log.error('Drop failed:', error);
        vscode.window.showErrorMessage(`Could not move: ${error instanceof Error ? error.message : error}`);
    }
    // What went through before an error is shown too
    return dropped.length > 0 ? { container: verdict.container.nodeId, nodes: dropped } : undefined;
}
