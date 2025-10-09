// import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContextMenu } from '../../../../../webview/solution-view/components/ContextMenu/ContextMenu';
import { NodeType } from '../../../../../webview/solution-view/types';

describe('ContextMenu Dependencies Reveal Test', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        onClose: jest.fn(),
        onRename: jest.fn(),
        onAction: jest.fn(),
        nodeType: 'dependencies',
        nodeName: 'Dependencies'
    } as const;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should NOT show "Reveal in Explorer" for dependencies node type', () => {
        render(<ContextMenu {...defaultProps} />);

        // Should not have any "Reveal in Explorer" item
        expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();

        // Menu should be empty or minimal for dependencies nodes
        const menuContent = document.querySelector('.context-menu-content');
        const menuItems = menuContent?.querySelectorAll('.context-menu-item') || [];

        // Dependencies should have minimal menu items (basically none)
        expect(menuItems.length).toBe(0);
    });

    it('should NOT show "Reveal in Explorer" for individual dependency items', () => {
        render(
            <ContextMenu
                {...defaultProps}
                nodeType="dependency"
                nodeName="System.Text.Json (6.0.0)"
            />
        );

        expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
    });

    it('should verify that other node types DO show "Reveal in Explorer"', () => {
        const testCases: Array<{nodeType: NodeType, nodeName: string}> = [
            { nodeType: 'file', nodeName: 'Program.cs' },
            { nodeType: 'folder', nodeName: 'Controllers' },
            { nodeType: 'project', nodeName: 'MyProject.csproj' },
            { nodeType: 'solutionFolder', nodeName: 'Solution Items' }
        ];

        testCases.forEach(({ nodeType, nodeName }) => {
            const { unmount } = render(
                <ContextMenu
                    {...defaultProps}
                    nodeType={nodeType}
                    nodeName={nodeName}
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
            unmount();
        });
    });

    it('should handle folder named "Dependencies" with type "folder" correctly', () => {
        // This tests the edge case where a regular folder might be named "Dependencies"
        // but has type 'folder' instead of 'dependencies'
        render(
            <ContextMenu
                {...defaultProps}
                nodeType="folder"
                nodeName="Dependencies"
            />
        );

        // This should show "Reveal in Explorer" because it's a regular folder,
        // even though it's named "Dependencies"
        expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
    });

    it('should verify context menu logic excludes only the correct types', () => {
        const shouldNotHaveReveal: NodeType[] = ['dependencies', 'dependency'];
        const shouldHaveReveal: NodeType[] = ['file', 'folder', 'project', 'solutionFolder', 'solution'];

        // Test types that should NOT have "Reveal in Explorer"
        shouldNotHaveReveal.forEach(nodeType => {
            const { unmount } = render(
                <ContextMenu
                    {...defaultProps}
                    nodeType={nodeType}
                    nodeName={`Test ${nodeType}`}
                />
            );

            expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
            unmount();
        });

        // Test types that SHOULD have "Reveal in Explorer"
        shouldHaveReveal.forEach(nodeType => {
            const { unmount } = render(
                <ContextMenu
                    {...defaultProps}
                    nodeType={nodeType}
                    nodeName={`Test ${nodeType}`}
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
            unmount();
        });
    });
});