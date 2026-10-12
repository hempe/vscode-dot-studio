import * as vscode from 'vscode';
import { NodeType } from '../../types';
import { NodeIdString } from '../../types/nodeId';
import { COMMAND_PREFIX, MenuCommandAction, menuCommands } from '../../core/contextMenus';
import { SolutionWebviewProvider } from './SolutionWebviewProvider';

/**
 * Context set on tree rows via `data-vscode-context` in the solution webview.
 * VS Code passes it as the argument to commands invoked from `webview/context` menus.
 */
export interface NodeMenuContext {
    readonly webviewSection: 'node';
    readonly nodeType: NodeType;
    readonly nodeId: NodeIdString;
}

/**
 * Registers the commands behind the Solution Explorer context menus (see core/contextMenus.ts).
 * From a menu they receive the clicked node's context; from a key binding they get no argument
 * and act on the focused tree node.
 */
export function registerNativeContextMenuCommands(provider: SolutionWebviewProvider): vscode.Disposable[] {
    return (Object.keys(menuCommands) as MenuCommandAction[]).map(action =>
        vscode.commands.registerCommand(COMMAND_PREFIX + action, (ctx?: NodeMenuContext) => {
            const nodeId = ctx?.nodeId ?? provider.focusedNodeId;
            if (!nodeId) {
                return;
            }
            return provider.runNodeAction(action, nodeId);
        })
    );
}
