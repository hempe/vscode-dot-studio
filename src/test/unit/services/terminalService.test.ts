import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TerminalService, TerminalCommand } from '../../../services/terminalService';

describe('TerminalService', () => {
    let createTerminalStub: sinon.SinonStub;
    let mockTerminal: any;

    beforeEach(() => {
        mockTerminal = {
            show: sinon.stub(),
            sendText: sinon.stub(),
            dispose: sinon.stub()
        };
        
        createTerminalStub = sinon.stub(vscode.window, 'createTerminal').returns(mockTerminal);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('executeDotNetCommand', () => {
        it('should create terminal with correct configuration', async () => {
            const command: TerminalCommand = {
                name: 'Test Command',
                command: 'dotnet --version',
                workingDirectory: '/path/to/project'
            };

            const result = await TerminalService.executeDotNetCommand(command);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Test Command',
                cwd: '/path/to/project'
            });
            sinon.assert.calledOnce(mockTerminal.show);
            sinon.assert.calledOnceWithExactly(mockTerminal.sendText, 'dotnet --version');
            sinon.assert.match(result, mockTerminal);
        });

        it('should not show terminal when showTerminal is false', async () => {
            const command: TerminalCommand = {
                name: 'Hidden Command',
                command: 'dotnet build',
                showTerminal: false
            };

            await TerminalService.executeDotNetCommand(command);

            sinon.assert.notCalled(mockTerminal.show);
            sinon.assert.calledOnceWithExactly(mockTerminal.sendText, 'dotnet build');
        });
    });

    describe('buildSolution', () => {
        it('should execute build command with correct parameters', async () => {
            const solutionPath = '/path/to/solution/MySolution.sln';

            const result = await TerminalService.buildSolution(solutionPath);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Build MySolution',
                cwd: '/path/to/solution'
            });
            sinon.assert.calledOnceWithExactly(mockTerminal.sendText, 'dotnet build "/path/to/solution/MySolution.sln"');
            sinon.assert.match(result, mockTerminal);
        });
    });

    describe('rebuildSolution', () => {
        it('should execute clean and build commands', async () => {
            const solutionPath = '/path/to/solution/MySolution.sln';

            const result = await TerminalService.rebuildSolution(solutionPath);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Rebuild MySolution',
                cwd: '/path/to/solution'
            });
            sinon.assert.calledOnceWithExactly(
                mockTerminal.sendText, 
                'dotnet clean "/path/to/solution/MySolution.sln" && dotnet build "/path/to/solution/MySolution.sln"'
            );
            sinon.assert.match(result, mockTerminal);
        });
    });

    describe('cleanSolution', () => {
        it('should execute clean command with correct parameters', async () => {
            const solutionPath = '/path/to/solution/MySolution.sln';

            const result = await TerminalService.cleanSolution(solutionPath);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Clean MySolution',
                cwd: '/path/to/solution'
            });
            sinon.assert.calledOnceWithExactly(mockTerminal.sendText, 'dotnet clean "/path/to/solution/MySolution.sln"');
            sinon.assert.match(result, mockTerminal);
        });
    });

    describe('installPackage', () => {
        it('should install package without version', async () => {
            const solutionPath = '/path/to/solution/MySolution.sln';
            const packageId = 'Newtonsoft.Json';

            const result = await TerminalService.installPackage(solutionPath, packageId);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Install Newtonsoft.Json',
                cwd: '/path/to/solution'
            });
            sinon.assert.calledOnceWithExactly(mockTerminal.sendText, 'dotnet add package Newtonsoft.Json');
            sinon.assert.match(result, mockTerminal);
        });

        it('should install package with specific version', async () => {
            const solutionPath = '/path/to/solution/MySolution.sln';
            const packageId = 'Newtonsoft.Json';
            const version = '13.0.3';

            const result = await TerminalService.installPackage(solutionPath, packageId, version);

            sinon.assert.calledOnceWithExactly(createTerminalStub, {
                name: 'Install Newtonsoft.Json',
                cwd: '/path/to/solution'
            });
            sinon.assert.calledOnceWithExactly(
                mockTerminal.sendText, 
                'dotnet add package Newtonsoft.Json --version 13.0.3'
            );
            sinon.assert.match(result, mockTerminal);
        });
    });

    describe('isDotNetAvailable', () => {
        it('should return true by default', async () => {
            const result = await TerminalService.isDotNetAvailable();
            
            sinon.assert.match(result, true);
            sinon.assert.calledOnce(mockTerminal.dispose);
        });
    });
});