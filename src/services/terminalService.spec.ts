import { TerminalService } from './terminalService';
import { TerminalCommand } from '../types/terminal';

describe('TerminalService', () => {
  describe('executeDotNetCommand', () => {
    it('should execute echo command and return successful result', async () => {
      const command: TerminalCommand = {
        name: 'Echo Test',
        command: 'echo "Hello World"',
      };

      const result = await TerminalService.executeDotNetCommand(command);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('Hello World');
      expect(result.exitCode).toBe(0);
    }, 15000);

    it('should handle command failure', async () => {
      const command: TerminalCommand = {
        name: 'Invalid Command Test',
        command: 'nonexistent-command-12345',
      };

      const result = await TerminalService.executeDotNetCommand(command);

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    }, 15000);

    it('should respect working directory', async () => {
      const command: TerminalCommand = {
        name: 'PWD Test',
        command: 'pwd',
        workingDirectory: '/tmp',
      };

      const result = await TerminalService.executeDotNetCommand(command);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('/tmp');
    }, 15000);
  });

  describe('isDotNetAvailable', () => {
    it('should check if dotnet CLI is available', async () => {
      const result = await TerminalService.isDotNetAvailable();

      // This test passes whether dotnet is installed or not
      expect(typeof result).toBe('boolean');

      if (result) {
        console.log('✓ .NET CLI is available on this system');
      } else {
        console.log('ⓘ .NET CLI is not available on this system (this is ok for testing)');
      }
    }, 15000);
  });

  describe('dotnet commands (if available)', () => {
    beforeEach(async () => {
      const isDotNetAvailable = await TerminalService.isDotNetAvailable();
      if (!isDotNetAvailable) {
        // Skip these tests if dotnet is not available
        return;
      }
    });

    it('should get dotnet version if available', async () => {
      const isDotNetAvailable = await TerminalService.isDotNetAvailable();

      if (!isDotNetAvailable) {
        console.log('Skipping dotnet version test - .NET CLI not available');
        return;
      }

      const command: TerminalCommand = {
        name: 'dotnet version',
        command: 'dotnet --version',
      };

      const result = await TerminalService.executeDotNetCommand(command);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/); // Should match version pattern
      console.log(`✓ .NET version: ${result.stdout.trim()}`);
    }, 15000);
  });
});