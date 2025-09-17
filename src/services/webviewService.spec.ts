import { WebviewService } from './webviewService';
import { WebviewMessage } from '../types/webview';

describe('WebviewService', () => {
  beforeEach(() => {
    // Clear any existing handlers and message queues
    WebviewService.unregisterMessageHandlers('test-webview');
  });

  describe('message handling', () => {
    it('should register and call message handlers', async () => {
      const mockHandler = jest.fn();
      const message: WebviewMessage = {
        type: 'test-message',
        payload: { data: 'test' },
      };

      WebviewService.registerMessageHandler('test-webview', mockHandler);
      await WebviewService.handleIncomingMessage('test-webview', message);

      expect(mockHandler).toHaveBeenCalledWith(message);
    });

    it('should handle multiple message handlers', async () => {
      const mockHandler1 = jest.fn();
      const mockHandler2 = jest.fn();
      const message: WebviewMessage = {
        type: 'test-message',
        payload: { data: 'test' },
      };

      WebviewService.registerMessageHandler('test-webview', mockHandler1);
      WebviewService.registerMessageHandler('test-webview', mockHandler2);
      await WebviewService.handleIncomingMessage('test-webview', message);

      expect(mockHandler1).toHaveBeenCalledWith(message);
      expect(mockHandler2).toHaveBeenCalledWith(message);
    });

    it('should handle errors in message handlers gracefully', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      const workingHandler = jest.fn();
      const message: WebviewMessage = {
        type: 'test-message',
        payload: { data: 'test' },
      };

      // Mock console.error to avoid noise in test output
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      WebviewService.registerMessageHandler('test-webview', errorHandler);
      WebviewService.registerMessageHandler('test-webview', workingHandler);

      await WebviewService.handleIncomingMessage('test-webview', message);

      expect(errorHandler).toHaveBeenCalled();
      expect(workingHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error handling message'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should unregister message handlers', async () => {
      const mockHandler = jest.fn();
      const message: WebviewMessage = {
        type: 'test-message',
        payload: { data: 'test' },
      };

      WebviewService.registerMessageHandler('test-webview', mockHandler);
      WebviewService.unregisterMessageHandlers('test-webview');
      await WebviewService.handleIncomingMessage('test-webview', message);

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('message queueing', () => {
    it('should queue and retrieve messages', () => {
      const message1: WebviewMessage = { type: 'message-1', payload: { data: '1' } };
      const message2: WebviewMessage = { type: 'message-2', payload: { data: '2' } };

      WebviewService.sendMessage('test-webview', message1);
      WebviewService.sendMessage('test-webview', message2);

      const queuedMessages = WebviewService.getQueuedMessages('test-webview');

      expect(queuedMessages).toHaveLength(2);
      expect(queuedMessages[0]).toEqual(message1);
      expect(queuedMessages[1]).toEqual(message2);
    });

    it('should clear message queue after retrieval', () => {
      const message: WebviewMessage = { type: 'test-message' };

      WebviewService.sendMessage('test-webview', message);

      // First call should return the message
      const firstCall = WebviewService.getQueuedMessages('test-webview');
      expect(firstCall).toHaveLength(1);

      // Second call should return empty array
      const secondCall = WebviewService.getQueuedMessages('test-webview');
      expect(secondCall).toHaveLength(0);
    });

    it('should handle multiple webview instances separately', () => {
      const message1: WebviewMessage = { type: 'webview-1-message' };
      const message2: WebviewMessage = { type: 'webview-2-message' };

      WebviewService.sendMessage('webview-1', message1);
      WebviewService.sendMessage('webview-2', message2);

      const webview1Messages = WebviewService.getQueuedMessages('webview-1');
      const webview2Messages = WebviewService.getQueuedMessages('webview-2');

      expect(webview1Messages).toHaveLength(1);
      expect(webview1Messages[0]).toEqual(message1);
      expect(webview2Messages).toHaveLength(1);
      expect(webview2Messages[0]).toEqual(message2);
    });
  });

  describe('utility methods', () => {
    describe('generateNonce', () => {
      it('should generate a nonce of correct length', () => {
        const nonce = WebviewService.generateNonce();
        expect(nonce).toHaveLength(32);
      });

      it('should generate different nonces on each call', () => {
        const nonce1 = WebviewService.generateNonce();
        const nonce2 = WebviewService.generateNonce();
        expect(nonce1).not.toBe(nonce2);
      });

      it('should generate nonces containing only valid characters', () => {
        const nonce = WebviewService.generateNonce();
        const validChars = /^[A-Za-z0-9]+$/;
        expect(nonce).toMatch(validChars);
      });
    });

    describe('generateCSP', () => {
      it('should generate CSP with provided nonce', () => {
        const nonce = 'test-nonce-123';
        const csp = WebviewService.generateCSP(nonce);

        expect(csp).toContain(`'nonce-${nonce}'`);
        expect(csp).toContain('default-src \'none\'');
        expect(csp).toContain('script-src');
        expect(csp).toContain('style-src \'unsafe-inline\'');
        expect(csp).toContain('connect-src https://azuresearch-usnc.nuget.org');
      });
    });
  });
});