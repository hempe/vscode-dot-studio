// import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../../../../../webview/solution-view/components/ContextMenu/ContextMenu';

describe('ContextMenu Regression Fixes', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        onClose: jest.fn(),
        onRename: jest.fn(),
        onAction: jest.fn(),
        nodeType: 'file',
        nodeName: 'test.cs'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Solution node rename functionality', () => {
        it('should show rename option for solution nodes', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="solution"
                    nodeName="TestSolution.sln"
                />
            );

            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('F2')).toBeInTheDocument();
        });

        it('should call onRename when rename is clicked for solution', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="solution"
                    nodeName="TestSolution.sln"
                />
            );

            fireEvent.click(screen.getByText('Rename'));
            expect(defaultProps.onRename).toHaveBeenCalled();
            expect(defaultProps.onClose).toHaveBeenCalled();
        });
    });

    describe('Dependencies node context menu', () => {
        it('should NOT show "Reveal in Explorer" for dependencies node', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="dependencies"
                    nodeName="Dependencies"
                />
            );

            expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
        });

        it('should NOT show "Reveal in Explorer" for individual dependency nodes', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="dependency"
                    nodeName="System.Text.Json (6.0.0)"
                />
            );

            expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
        });

        it('should show "Reveal in Explorer" for regular folders', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="folder"
                    nodeName="src"
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });

        it('should show "Reveal in Explorer" for files', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="Program.cs"
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });

        it('should show "Reveal in Explorer" for projects', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="project"
                    nodeName="TestProject.csproj"
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });

        it('should show "Reveal in Explorer" for solution folders', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="solutionFolder"
                    nodeName="Solution Items"
                />
            );

            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });
    });

    describe('Context menu keyboard navigation', () => {
        it('should focus first menu item initially', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            const openItem = screen.getByText('Open').parentElement;
            expect(openItem).toHaveClass('focused');
        });

        it('should navigate down with arrow keys', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            // First item (Open) should be focused
            const openItem = screen.getByText('Open').parentElement;
            expect(openItem).toHaveClass('focused');

            // Press arrow down
            fireEvent.keyDown(document, { key: 'ArrowDown' });

            // Second item (Rename) should be focused
            const renameItem = screen.getByText('Rename').parentElement;
            expect(renameItem).toHaveClass('focused');
            expect(openItem).not.toHaveClass('focused');
        });

        it('should navigate up with arrow keys', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            // Start at first item
            expect(screen.getByText('Open').parentElement).toHaveClass('focused');

            // Press arrow down twice to get to third item
            fireEvent.keyDown(document, { key: 'ArrowDown' });
            fireEvent.keyDown(document, { key: 'ArrowDown' });

            // Should be at Delete
            const deleteItem = screen.getByText('Delete').parentElement;
            expect(deleteItem).toHaveClass('focused');

            // Press arrow up
            fireEvent.keyDown(document, { key: 'ArrowUp' });

            // Should be back at Rename
            const renameItem = screen.getByText('Rename').parentElement;
            expect(renameItem).toHaveClass('focused');
            expect(deleteItem).not.toHaveClass('focused');
        });

        it('should wrap around when navigating past edges', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            // Start at first item
            expect(screen.getByText('Open').parentElement).toHaveClass('focused');

            // Press arrow up (should wrap to last item)
            fireEvent.keyDown(document, { key: 'ArrowUp' });

            // Should be at last item (Reveal in Explorer)
            const revealItem = screen.getByText('Reveal in Explorer').parentElement;
            expect(revealItem).toHaveClass('focused');
        });

        it('should execute focused item on Enter', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            // First item (Open) should be focused
            expect(screen.getByText('Open').parentElement).toHaveClass('focused');

            // Press Enter
            fireEvent.keyDown(document, { key: 'Enter' });

            // Should call onAction with 'openFile'
            expect(defaultProps.onAction).toHaveBeenCalledWith('openFile', undefined);
            expect(defaultProps.onClose).toHaveBeenCalled();
        });

        it('should close menu on Escape', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(defaultProps.onClose).toHaveBeenCalled();
        });

        it('should skip separators during navigation', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="project"
                    nodeName="TestProject.csproj"
                />
            );

            // Navigate to find items around separator
            let currentItem = screen.getByText('Rename').parentElement;
            expect(currentItem).toHaveClass('focused');

            // Navigate down to Delete
            fireEvent.keyDown(document, { key: 'ArrowDown' });
            fireEvent.keyDown(document, { key: 'ArrowDown' });

            currentItem = screen.getByText('Delete').parentElement;
            expect(currentItem).toHaveClass('focused');

            // Navigate down once more - should skip separator and go to Build
            fireEvent.keyDown(document, { key: 'ArrowDown' });

            currentItem = screen.getByText('Build').parentElement;
            expect(currentItem).toHaveClass('focused');
        });
    });

    describe('Menu item focus state', () => {
        it('should show focused state correctly', () => {
            render(
                <ContextMenu
                    {...defaultProps}
                    nodeType="file"
                    nodeName="test.cs"
                />
            );

            const openItem = screen.getByText('Open').parentElement;
            const renameItem = screen.getByText('Rename').parentElement;

            // Initially first item should be focused
            expect(openItem).toHaveClass('focused');
            expect(renameItem).not.toHaveClass('focused');

            // After navigation, focus should move
            fireEvent.keyDown(document, { key: 'ArrowDown' });

            expect(openItem).not.toHaveClass('focused');
            expect(renameItem).toHaveClass('focused');
        });
    });
});