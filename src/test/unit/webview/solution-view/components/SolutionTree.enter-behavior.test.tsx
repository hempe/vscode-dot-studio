import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';

describe('SolutionTree Enter Key Behavior', () => {
    const mockOnProjectAction = jest.fn();

    const createMockProjects = () => [
        {
            name: 'TestSolution',
            path: '/test/TestSolution.sln',
            type: 'solution',
            children: [
                {
                    name: 'Solution Items',
                    path: '/test/solution-items',
                    type: 'solutionFolder',
                    children: [
                        {
                            name: 'readme.txt',
                            path: '/test/readme.txt',
                            type: 'file'
                        }
                    ]
                },
                {
                    name: 'WebApp',
                    path: '/test/WebApp',
                    type: 'project',
                    children: [
                        {
                            name: 'Dependencies',
                            path: '/test/WebApp/dependencies',
                            type: 'dependencies',
                            children: [
                                {
                                    name: 'Newtonsoft.Json (13.0.1)',
                                    path: '/test/WebApp/dependencies/Newtonsoft.Json',
                                    type: 'dependency'
                                }
                            ]
                        },
                        {
                            name: 'Controllers',
                            path: '/test/WebApp/Controllers',
                            type: 'folder',
                            children: [
                                {
                                    name: 'HomeController.cs',
                                    path: '/test/WebApp/Controllers/HomeController.cs',
                                    type: 'file'
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    const renderSolutionTree = () => {
        render(
            <SolutionTree
                projects={createMockProjects()}
                onProjectAction={mockOnProjectAction}
            />
        );
    };

    test('should open file when Enter is pressed on file node', async () => {
        const user = userEvent.setup();
        renderSolutionTree();

        const treeContainer = document.querySelector('.solution-tree');
        if (treeContainer) {
            fireEvent.focus(treeContainer);
        }

        // Expand solution to see solution items
        await user.keyboard('{ArrowRight}');
        // Navigate to Solution Items
        await user.keyboard('{ArrowDown}');
        // Expand Solution Items
        await user.keyboard('{ArrowRight}');
        // Navigate to readme.txt file
        await user.keyboard('{ArrowDown}');

        // Press Enter on the file
        await user.keyboard('{Enter}');

        expect(mockOnProjectAction).toHaveBeenCalledWith('openFile', '/test/readme.txt');
    });

    test('should only expand/collapse solution folders, never open', async () => {
        const user = userEvent.setup();
        renderSolutionTree();

        const treeContainer = document.querySelector('.solution-tree');
        if (treeContainer) {
            fireEvent.focus(treeContainer);
        }

        // Expand solution to see solution items
        await user.keyboard('{ArrowRight}');
        // Navigate to Solution Items (solution folder)
        await user.keyboard('{ArrowDown}');

        // Press Enter on the solution folder - should only expand, never try to open
        await user.keyboard('{Enter}');

        // Should not call openFile for solution folders
        expect(mockOnProjectAction).not.toHaveBeenCalledWith('openFile', '/test/solution-items');

        // Solution Items should be expanded (can check by finding its child)
        const childFile = await screen.findByText('readme.txt');
        expect(childFile).toBeInTheDocument();
    });

    test('should only expand/collapse dependencies folder, never open', async () => {
        const user = userEvent.setup();
        renderSolutionTree();

        const treeContainer = document.querySelector('.solution-tree');
        if (treeContainer) {
            fireEvent.focus(treeContainer);
        }

        // Navigate to project and expand it
        await user.keyboard('{ArrowRight}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowRight}');

        // Should now be at Dependencies folder, press Enter
        await user.keyboard('{Enter}');

        // Should not call openFile for dependencies folder
        expect(mockOnProjectAction).not.toHaveBeenCalledWith('openFile', '/test/WebApp/dependencies');
    });

    test('should expand/collapse regular folders when Enter is pressed', async () => {
        const user = userEvent.setup();
        renderSolutionTree();

        const treeContainer = document.querySelector('.solution-tree');
        if (treeContainer) {
            fireEvent.focus(treeContainer);
        }

        // Navigate to WebApp project and expand
        await user.keyboard('{ArrowRight}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowRight}');

        // Navigate to Controllers folder (skip Dependencies)
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');

        // Press Enter on regular folder - should expand
        await user.keyboard('{Enter}');

        // Should not try to open the folder
        expect(mockOnProjectAction).not.toHaveBeenCalledWith('openFile', '/test/WebApp/Controllers');

        // Controllers folder should expand and show its contents
        const homeController = await screen.findByText('HomeController.cs');
        expect(homeController).toBeInTheDocument();
    });

    test('should expand/collapse projects when Enter is pressed', async () => {
        const user = userEvent.setup();
        renderSolutionTree();

        const treeContainer = document.querySelector('.solution-tree');
        if (treeContainer) {
            fireEvent.focus(treeContainer);
        }

        // Navigate to WebApp project
        await user.keyboard('{ArrowRight}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');

        // Press Enter on project - should expand, not open
        await user.keyboard('{Enter}');

        // Should not try to open the project file
        expect(mockOnProjectAction).not.toHaveBeenCalledWith('openFile', '/test/WebApp');

        // Project should expand and show Dependencies
        const dependencies = await screen.findByText('Dependencies');
        expect(dependencies).toBeInTheDocument();
    });
});