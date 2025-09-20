import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';

describe('SolutionTree Expansion Fixes', () => {
    const mockOnProjectAction = jest.fn();

    beforeEach(() => {
        mockOnProjectAction.mockClear();
    });

    describe('Solution folder expansion fix', () => {
        it('should not crash when clicking empty solution folders', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Empty Folder',
                    path: '/solution/EmptyFolder',
                    children: [] // Empty but children array exists - this is the fix
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Empty Folder');

            // Should be able to click without crashing (the fix prevents sort() on undefined)
            expect(() => fireEvent.click(folderNode)).not.toThrow();
        });

        it('should show expand icon for solution folders with children', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Folder with Children',
                    path: '/solution/FolderWithChildren',
                    children: [
                        {
                            type: 'project',
                            name: 'Child Project',
                            path: '/solution/ChildProject.csproj'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Folder with Children');

            // Should show expand icon for folders with children
            const expandIcon = folderNode.parentElement?.querySelector('.expand-icon');
            expect(expandIcon).toHaveClass('codicon-chevron-right');

            // Verify clicking doesn't crash
            expect(() => fireEvent.click(folderNode)).not.toThrow();
        });
    });

    describe('Arrow key navigation fix', () => {
        it('should handle left arrow key on project nodes without crashing', () => {
            const projects = [
                {
                    type: 'project',
                    name: 'Test Project',
                    path: '/solution/TestProject.csproj',
                    children: []
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const projectNode = screen.getByText('Test Project');

            // Focus the project first
            fireEvent.click(projectNode);

            // Press left arrow - should not crash (tests the navigation fix)
            expect(() => fireEvent.keyDown(document, { key: 'ArrowLeft' })).not.toThrow();
        });

        it('should handle arrow navigation on nodes with different structures', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Solution Folder',
                    path: '/solution/SolutionFolder',
                    children: [
                        {
                            type: 'project',
                            name: 'Nested Project',
                            path: '/solution/NestedProject.csproj'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            // Test basic keyboard navigation
            expect(() => fireEvent.keyDown(document, { key: 'ArrowDown' })).not.toThrow();
            expect(() => fireEvent.keyDown(document, { key: 'ArrowUp' })).not.toThrow();
            expect(() => fireEvent.keyDown(document, { key: 'ArrowLeft' })).not.toThrow();
            expect(() => fireEvent.keyDown(document, { key: 'ArrowRight' })).not.toThrow();
        });
    });

    describe('Basic click behavior', () => {
        it('should handle clicking nodes with children', () => {
            const projects = [
                {
                    type: 'folder',
                    name: 'Source Folder',
                    path: '/solution/src',
                    children: [
                        {
                            type: 'file',
                            name: 'index.cs',
                            path: '/solution/src/index.cs'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Source Folder');

            // Should have expand icon
            const expandIcon = folderNode.parentElement?.querySelector('.expand-icon');
            expect(expandIcon).toHaveClass('codicon-chevron-right');

            // Click should not crash
            expect(() => fireEvent.click(folderNode)).not.toThrow();
        });

        it('should handle clicking nodes without children', () => {
            const projects = [
                {
                    type: 'project',
                    name: 'EmptyProject.csproj',
                    path: '/solution/EmptyProject.csproj'
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const projectNode = screen.getByText('EmptyProject.csproj');

            // Click should not crash
            expect(() => fireEvent.click(projectNode)).not.toThrow();
        });
    });
});