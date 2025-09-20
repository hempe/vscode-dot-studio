import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../../../../../webview/solution-view/components/ContextMenu/ContextMenu';

describe('ContextMenu Node Type Specific Behavior', () => {
    const mockOnClose = jest.fn();
    const mockOnRename = jest.fn();
    const mockOnAction = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Clean up any open menus
        document.body.innerHTML = '';
    });

    describe('Dependencies Node', () => {
        test('should NOT show Rename, Delete, or Reveal options', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="dependencies"
                    nodeName="Dependencies"
                />
            );

            // Dependencies node should have minimal or no context menu options
            expect(screen.queryByText('Rename')).not.toBeInTheDocument();
            expect(screen.queryByText('Delete')).not.toBeInTheDocument();
            expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
        });
    });

    describe('Solution Node', () => {
        test('should show Rename option', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="solution"
                    nodeName="TestSolution"
                />
            );

            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('F2')).toBeInTheDocument();
            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });

        test('should NOT show Open, Delete, or Build options', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="solution"
                    nodeName="TestSolution"
                />
            );

            expect(screen.queryByText('Open')).not.toBeInTheDocument();
            expect(screen.queryByText('Delete')).not.toBeInTheDocument();
            expect(screen.queryByText('Build')).not.toBeInTheDocument();
        });
    });

    describe('Solution Folder Node', () => {
        test('should show Rename option but NOT Open action', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="solutionFolder"
                    nodeName="Solution Items"
                />
            );

            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('F2')).toBeInTheDocument();
            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
            expect(screen.queryByText('Open')).not.toBeInTheDocument();
        });
    });

    describe('Project Node', () => {
        test('should show all project-specific options', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="project"
                    nodeName="TestProject"
                />
            );

            // Project should have rename, remove, delete, and build options
            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('Remove from Solution')).toBeInTheDocument();
            expect(screen.getByText('Delete')).toBeInTheDocument();
            expect(screen.getByText('Build')).toBeInTheDocument();
            expect(screen.getByText('Rebuild')).toBeInTheDocument();
            expect(screen.getByText('Clean')).toBeInTheDocument();
            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });

        test('should call correct actions when clicked', () => {
            const { unmount } = render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="project"
                    nodeName="TestProject"
                />
            );

            // Test Remove from Solution
            fireEvent.click(screen.getByText('Remove from Solution'));
            expect(mockOnAction).toHaveBeenCalledWith('removeProject', undefined);
            expect(mockOnClose).toHaveBeenCalled();

            jest.clearAllMocks();
            unmount();

            // Re-render for next test
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="project"
                    nodeName="TestProject"
                />
            );

            // Test Delete - get all Delete buttons and use the first one
            const deleteButtons = screen.getAllByText('Delete');
            fireEvent.click(deleteButtons[0]);
            expect(mockOnAction).toHaveBeenCalledWith('deleteProject', undefined);
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    describe('Individual Dependency Node', () => {
        test('should have minimal functionality', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="dependency"
                    nodeName="Newtonsoft.Json (13.0.1)"
                />
            );

            // Individual dependencies should not have Reveal in Explorer
            expect(screen.queryByText('Rename')).not.toBeInTheDocument();
            expect(screen.queryByText('Delete')).not.toBeInTheDocument();
            expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
        });
    });

    describe('File Node', () => {
        test('should show file-specific options', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="file"
                    nodeName="Program.cs"
                />
            );

            expect(screen.getByText('Open')).toBeInTheDocument();
            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('Delete')).toBeInTheDocument();
            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
        });
    });

    describe('Regular Folder Node', () => {
        test('should show folder-specific options', () => {
            render(
                <ContextMenu
                    x={100}
                    y={100}
                    onClose={mockOnClose}
                    onRename={mockOnRename}
                    onAction={mockOnAction}
                    nodeType="folder"
                    nodeName="Controllers"
                />
            );

            expect(screen.getByText('Rename')).toBeInTheDocument();
            expect(screen.getByText('Delete')).toBeInTheDocument();
            expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();
            expect(screen.queryByText('Open')).not.toBeInTheDocument();
        });
    });
});