import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';

describe('SolutionTree Solution Items', () => {
    const mockOnProjectAction = jest.fn();

    beforeEach(() => {
        mockOnProjectAction.mockClear();
    });

    describe('Solution folder with solution items', () => {
        it('should display solution items correctly', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Solution Items',
                    path: '/solution/Solution Items',
                    children: [
                        {
                            type: 'file',
                            name: 'icon.png',
                            path: '/solution/icon.png'
                        },
                        {
                            type: 'file',
                            name: 'icon.svg',
                            path: '/solution/icon.svg'
                        },
                        {
                            type: 'file',
                            name: 'LICENCE.md',
                            path: '/solution/LICENCE.md'
                        },
                        {
                            type: 'file',
                            name: 'README.md',
                            path: '/solution/README.md'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            // Should show solution folder with correct icon
            const solutionFolder = screen.getByText('Solution Items');
            expect(solutionFolder).toBeInTheDocument();

            // Should show expand icon since it has children
            const expandIcon = solutionFolder.parentElement?.querySelector('.expand-icon');
            expect(expandIcon).toHaveClass('codicon-chevron-right');

            // Solution folder should use folder icon, not question mark
            const folderIcon = solutionFolder.parentElement?.querySelector('.node-icon');
            expect(folderIcon).toHaveClass('codicon-folder');
        });

        it('should be clickable when it has solution items', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Solution Items',
                    path: '/solution/Solution Items',
                    children: [
                        {
                            type: 'file',
                            name: 'README.md',
                            path: '/solution/README.md'
                        },
                        {
                            type: 'file',
                            name: 'LICENCE.md',
                            path: '/solution/LICENCE.md'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const solutionFolder = screen.getByText('Solution Items');

            // Should show expand icon since it has children
            const expandIcon = solutionFolder.parentElement?.querySelector('.expand-icon');
            expect(expandIcon).toHaveClass('codicon-chevron-right');

            // Should be clickable without crashing
            expect(() => fireEvent.click(solutionFolder)).not.toThrow();
        });

        it('should handle mixed children (projects and solution items)', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Mixed Folder',
                    path: '/solution/Mixed Folder',
                    children: [
                        {
                            type: 'project',
                            name: 'TestProject.csproj',
                            path: '/solution/TestProject/TestProject.csproj'
                        },
                        {
                            type: 'file',
                            name: 'config.json',
                            path: '/solution/config.json'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folder = screen.getByText('Mixed Folder');

            // Should show expand icon since it has children
            const expandIcon = folder.parentElement?.querySelector('.expand-icon');
            expect(expandIcon).toHaveClass('codicon-chevron-right');

            // Should be clickable without crashing
            expect(() => fireEvent.click(folder)).not.toThrow();
        });

        it('should handle empty solution folders without crashing', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Empty Solution Folder',
                    path: '/solution/Empty Solution Folder',
                    children: [] // Empty - this tests the fix
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Empty Solution Folder');

            // Should not crash when clicked
            expect(() => fireEvent.click(folderNode)).not.toThrow();

            // Should show folder icon correctly
            const folderIcon = folderNode.parentElement?.querySelector('.node-icon');
            expect(folderIcon).toHaveClass('codicon-folder');
        });
    });

    describe('Solution folder icons', () => {
        it('should show correct folder icon for solution folders', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Test Folder',
                    path: '/solution/Test Folder',
                    children: []
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Test Folder');
            const folderIcon = folderNode.parentElement?.querySelector('.node-icon');

            // Should show folder icon, not question mark
            expect(folderIcon).toHaveClass('codicon-folder');
            expect(folderIcon).not.toHaveClass('codicon-question');
        });

        it('should show closed folder icon initially', () => {
            const projects = [
                {
                    type: 'solutionFolder',
                    name: 'Test Folder',
                    path: '/solution/Test Folder',
                    children: [
                        {
                            type: 'file',
                            name: 'test.txt',
                            path: '/solution/test.txt'
                        }
                    ]
                }
            ];

            render(<SolutionTree projects={projects} onProjectAction={mockOnProjectAction} />);

            const folderNode = screen.getByText('Test Folder');
            const folderIcon = folderNode.parentElement?.querySelector('.node-icon');

            // Should show closed folder icon initially
            expect(folderIcon).toHaveClass('codicon-folder');
            expect(folderIcon).not.toHaveClass('codicon-folder-opened');
        });
    });
});