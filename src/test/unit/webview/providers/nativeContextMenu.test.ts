const registered = new Map<string, (...args: any[]) => any>();

jest.mock('vscode', () => ({
    commands: {
        registerCommand: jest.fn((id: string, handler: (...args: any[]) => any) => {
            registered.set(id, handler);
            return { dispose: jest.fn() };
        }),
    },
}), { virtual: true });

import { registerNativeContextMenuCommands } from '../../../../webview/providers/nativeContextMenu';
import { menuCommands } from '../../../../core/contextMenus';
import { NodeIdString } from '../../../../types/nodeId';

describe('registerNativeContextMenuCommands', () => {
    const provider = {
        focusedNodeId: undefined as NodeIdString | undefined,
        runNodeAction: jest.fn(),
    };

    beforeEach(() => {
        registered.clear();
        provider.focusedNodeId = undefined;
        provider.runNodeAction.mockClear();
        registerNativeContextMenuCommands(provider as any);
    });

    test('registers a command per menu action', () => {
        expect([...registered.keys()].sort()).toEqual(
            Object.keys(menuCommands).map(action => `dotnet.solutionExplorer.${action}`).sort()
        );
    });

    test('uses the node from the context menu', async () => {
        provider.focusedNodeId = 'focused' as NodeIdString;

        await registered.get('dotnet.solutionExplorer.build')!({ webviewSection: 'node', nodeType: 'project', nodeId: 'clicked' });

        expect(provider.runNodeAction).toHaveBeenCalledWith('build', 'clicked');
    });

    test('falls back to the focused node when invoked by a key binding', async () => {
        provider.focusedNodeId = 'focused' as NodeIdString;

        await registered.get('dotnet.solutionExplorer.rename')!();

        expect(provider.runNodeAction).toHaveBeenCalledWith('rename', 'focused');
    });

    test('does nothing without a node', async () => {
        await registered.get('dotnet.solutionExplorer.deleteFile')!();

        expect(provider.runNodeAction).not.toHaveBeenCalled();
    });
});
