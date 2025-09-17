import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu } from '../../../../../webview/solution-view/components/ContextMenu/ContextMenu';

describe('ContextMenu Tests', () => {
  const mockOnClose = jest.fn();
  const mockOnRename = jest.fn();
  const mockOnAction = jest.fn();

  let user: ReturnType<typeof userEvent.setup>;

  const defaultProps = {
    x: 100,
    y: 200,
    onClose: mockOnClose,
    onRename: mockOnRename,
    onAction: mockOnAction,
    nodeType: 'file',
    nodeName: 'Program.cs'
  };

  beforeEach(() => {
    user = userEvent.setup();
    mockOnClose.mockClear();
    mockOnRename.mockClear();
    mockOnAction.mockClear();

    // Clear console mocks
    (console.log as jest.Mock).mockClear();
    (console.debug as jest.Mock).mockClear();
    (console.info as jest.Mock).mockClear();
  });

  describe('Menu Items by Node Type', () => {
    test('should show file-specific menu items', () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();

      // Should not show project-specific items
      expect(screen.queryByText('Build')).not.toBeInTheDocument();
      expect(screen.queryByText('Rebuild')).not.toBeInTheDocument();
      expect(screen.queryByText('Clean')).not.toBeInTheDocument();
    });

    test('should show folder-specific menu items', () => {
      render(<ContextMenu {...defaultProps} nodeType="folder" nodeName="Controllers" />);

      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();

      // Should not show file-specific items
      expect(screen.queryByText('Open')).not.toBeInTheDocument();
      // Should not show project-specific items
      expect(screen.queryByText('Build')).not.toBeInTheDocument();
    });

    test('should show project-specific menu items', () => {
      render(<ContextMenu {...defaultProps} nodeType="project" nodeName="WebApp" />);

      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Build')).toBeInTheDocument();
      expect(screen.getByText('Rebuild')).toBeInTheDocument();
      expect(screen.getByText('Clean')).toBeInTheDocument();
      expect(screen.getByText('Reveal in Explorer')).toBeInTheDocument();

      // Should not show file-specific items
      expect(screen.queryByText('Open')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    test('should not show reveal option for dependencies', () => {
      render(<ContextMenu {...defaultProps} nodeType="dependency" nodeName="Newtonsoft.Json" />);

      expect(screen.queryByText('Reveal in Explorer')).not.toBeInTheDocument();
    });
  });

  describe('Menu Item Actions', () => {
    test('should call onAction with openFile when Open is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      await user.click(screen.getByText('Open'));

      expect(mockOnAction).toHaveBeenCalledWith('openFile', undefined);
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onRename when Rename is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      await user.click(screen.getByText('Rename'));

      expect(mockOnRename).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onAction with deleteFile when Delete is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      await user.click(screen.getByText('Delete'));

      expect(mockOnAction).toHaveBeenCalledWith('deleteFile', { type: 'file' });
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onAction with build when Build is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="project" />);

      await user.click(screen.getByText('Build'));

      expect(mockOnAction).toHaveBeenCalledWith('build', undefined);
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onAction with rebuild when Rebuild is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="project" />);

      await user.click(screen.getByText('Rebuild'));

      expect(mockOnAction).toHaveBeenCalledWith('rebuild', undefined);
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onAction with clean when Clean is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="project" />);

      await user.click(screen.getByText('Clean'));

      expect(mockOnAction).toHaveBeenCalledWith('clean', undefined);
      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should call onAction with revealInExplorer when Reveal in Explorer is clicked', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      await user.click(screen.getByText('Reveal in Explorer'));

      expect(mockOnAction).toHaveBeenCalledWith('revealInExplorer', undefined);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Menu Positioning', () => {
    test('should position menu at specified coordinates', () => {
      render(<ContextMenu {...defaultProps} x={150} y={250} />);

      const menuElement = document.querySelector('.context-menu') as HTMLElement;
      expect(menuElement.style.left).toBe('150px');
      expect(menuElement.style.top).toBe('250px');
    });

    test('should have correct z-index for layering', () => {
      render(<ContextMenu {...defaultProps} />);

      const menuElement = document.querySelector('.context-menu') as HTMLElement;
      expect(menuElement.style.zIndex).toBe('1000');
    });
  });

  describe('Menu Closing Behavior', () => {
    test('should close menu when clicking outside', async () => {
      render(<ContextMenu {...defaultProps} />);

      // Click outside the menu
      fireEvent.click(document.body);

      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should close menu when pressing Escape', () => {
      render(<ContextMenu {...defaultProps} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });

    test('should not close menu when clicking on menu content', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      const menuContent = document.querySelector('.context-menu-content');
      if (menuContent) {
        fireEvent.click(menuContent);
      }

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    test('should prevent propagation when clicking menu items', async () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      const openItem = screen.getByText('Open');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');

      fireEvent(openItem, clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Keyboard Shortcuts', () => {
    test('should display F2 shortcut for rename', () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      expect(screen.getByText('F2')).toBeInTheDocument();
    });
  });

  describe('Menu Separators', () => {
    test('should show separator before project actions', () => {
      render(<ContextMenu {...defaultProps} nodeType="project" />);

      const separators = document.querySelectorAll('.context-menu-separator');
      expect(separators.length).toBeGreaterThan(0);
    });

    test('should show separator before reveal in explorer', () => {
      render(<ContextMenu {...defaultProps} nodeType="file" />);

      const separators = document.querySelectorAll('.context-menu-separator');
      expect(separators.length).toBeGreaterThan(0);
    });
  });

  describe('Event Cleanup', () => {
    test('should remove event listeners when unmounted', () => {
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

      const { unmount } = render(<ContextMenu {...defaultProps} />);

      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });
});