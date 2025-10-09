// import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';

// Mock data for testing
const mockProjects = [
  {
    type: 'solution',
    name: 'TestSolution',
    path: '/test/TestSolution.sln',
    children: [
      {
        type: 'file',
        name: 'Program.cs',
        path: '/test/Program.cs'
      }
    ]
  }
];

describe('SolutionTree Context Menu Boundary Detection', () => {
  const mockOnProjectAction = jest.fn();

  beforeEach(() => {
    mockOnProjectAction.mockClear();
    // Clear console mocks
    (console.log as jest.Mock).mockClear();
    (console.debug as jest.Mock).mockClear();
    (console.info as jest.Mock).mockClear();

    // Reset window dimensions to known values
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });
  });

  const renderSolutionTree = () => {
    return render(
      <SolutionTree
        projects={mockProjects}
        onProjectAction={mockOnProjectAction}
      />
    );
  };

  describe('Right Edge Boundary Detection', () => {
    test('should adjust menu position when clicked near right edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click very close to right edge on solution node
      // Menu width is 220px, so anything > 1024 - 220 = 804px should adjust
      fireEvent.contextMenu(solutionNode, {
        clientX: 900, // Close to right edge
        clientY: 100
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Menu should be repositioned to stay within bounds
      // Expected position: 1024 - 220 = 804px
      const expectedX = 1024 - 220; // window width - menu width
      expect(contextMenu.style.left).toBe(`${expectedX}px`);
    });

    test('should not adjust menu position when clicked away from right edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click away from right edge
      fireEvent.contextMenu(solutionNode, {
        clientX: 100, // Far from right edge
        clientY: 100
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Menu should be at original position
      expect(contextMenu.style.left).toBe('100px');
    });
  });

  describe('Bottom Edge Boundary Detection', () => {
    test('should adjust menu position when clicked near bottom edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click very close to bottom edge
      // Menu height is 200px, so anything > 768 - 200 = 568px should adjust
      fireEvent.contextMenu(solutionNode, {
        clientX: 100,
        clientY: 700 // Close to bottom edge
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Menu should be repositioned to stay within bounds
      const expectedY = 768 - 200; // window height - menu height
      expect(contextMenu.style.top).toBe(`${expectedY}px`);
    });

    test('should not adjust menu position when clicked away from bottom edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click away from bottom edge
      fireEvent.contextMenu(solutionNode, {
        clientX: 100,
        clientY: 100 // Far from bottom edge
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Menu should be at original position
      expect(contextMenu.style.top).toBe('100px');
    });
  });

  describe('Corner Boundary Detection', () => {
    test('should adjust both X and Y when clicked near bottom-right corner', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click near bottom-right corner
      fireEvent.contextMenu(solutionNode, {
        clientX: 900, // Close to right edge
        clientY: 700  // Close to bottom edge
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Both X and Y should be adjusted
      const expectedX = 1024 - 220;
      const expectedY = 768 - 200;
      expect(contextMenu.style.left).toBe(`${expectedX}px`);
      expect(contextMenu.style.top).toBe(`${expectedY}px`);
    });
  });

  describe('Minimum Distance from Edges', () => {
    test('should maintain minimum distance from left edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click at very left edge (should be adjusted to edge)
      fireEvent.contextMenu(solutionNode, {
        clientX: -50, // Negative position (outside viewport)
        clientY: 100
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Should be adjusted to edge (0px)
      expect(contextMenu.style.left).toBe('0px');
    });

    test('should maintain minimum distance from top edge', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Simulate right-click at very top edge (should be adjusted to edge)
      fireEvent.contextMenu(solutionNode, {
        clientX: 100,
        clientY: -50 // Negative position (outside viewport)
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Should be adjusted to edge (0px)
      expect(contextMenu.style.top).toBe('0px');
    });
  });

  describe('Different Window Sizes', () => {
    test('should work correctly with smaller window width', () => {
      // Set smaller window size
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 400,
      });

      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Click near right edge of smaller window
      fireEvent.contextMenu(solutionNode, {
        clientX: 350,
        clientY: 100
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Should adjust for smaller window: 400 - 220 = 180px
      const expectedX = 400 - 220;
      expect(contextMenu.style.left).toBe(`${expectedX}px`);
    });

    test('should work correctly with smaller window height', () => {
      // Set smaller window size
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 300,
      });

      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Click near bottom edge of smaller window
      fireEvent.contextMenu(solutionNode, {
        clientX: 100,
        clientY: 250
      });

      const contextMenu = document.querySelector('.context-menu') as HTMLElement;
      expect(contextMenu).toBeInTheDocument();

      // Should adjust for smaller window: 300 - 200 = 100px
      const expectedY = 300 - 200;
      expect(contextMenu.style.top).toBe(`${expectedY}px`);
    });
  });

  describe('Focus Behavior on Right Click', () => {
    test('should focus node when right-clicked for context menu', () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');

      // Right-click should focus the node
      fireEvent.contextMenu(solutionNode, {
        clientX: 100,
        clientY: 100
      });

      // Check that the node has focused class
      const nodeElement = solutionNode.closest('.tree-node');
      expect(nodeElement).toHaveClass('focused');
    });
  });
});