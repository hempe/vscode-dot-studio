import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionCommands } from '../../../commands/solutionCommands';
import { SolutionProvider } from '../../../solutionProvider';
import { NuGetService } from '../../../services/nugetService';
import { TerminalService } from '../../../services/terminalService';
import { WebviewService } from '../../../services/webviewService';
import { ErrorUtils } from '../../../utils';

describe('SolutionCommands', () => {
    let mockContext: vscode.ExtensionContext;
    let mockSolutionProvider: SolutionProvider;
    let solutionCommands: SolutionCommands;
    let registerCommandStub: sinon.SinonStub;

    beforeEach(() => {
        mockContext = {
            subscriptions: []
        } as any;

        mockSolutionProvider = {
            refresh: sinon.stub(),
            addProjectToSolution: sinon.stub().resolves(true)
        } as any;

        registerCommandStub = sinon.stub(vscode.commands, 'registerCommand');
        
        solutionCommands = new SolutionCommands(mockContext, mockSolutionProvider);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('registerCommands', () => {
        it('should register all solution commands', () => {
            solutionCommands.registerCommands();

            const expectedCommands = [
                'dotnet-extension.refreshSolution',
                'dotnet-extension.renameSolution',
                'dotnet-extension.newProject',
                'dotnet-extension.addExistingProject',
                'dotnet-extension.newSolutionFolder',
                'dotnet-extension.buildSolution',
                'dotnet-extension.rebuildSolution',
                'dotnet-extension.cleanSolution',
                'dotnet-extension.manageSolutionNugetPackages'
            ];

            sinon.assert.callCount(registerCommandStub, expectedCommands.length);
            
            for (const command of expectedCommands) {
                sinon.assert.calledWith(registerCommandStub, command);
            }
        });
    });

    describe('buildSolution', () => {
        it('should build solution with valid item', async () => {
            const mockItem = {
                resourceUri: { fsPath: '/path/to/MySolution.sln' }
            };

            const buildStub = sinon.stub(TerminalService, 'buildSolution').resolves({} as any);
            const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage');

            // Access private method for testing
            await (solutionCommands as any).buildSolution(mockItem);

            sinon.assert.calledOnceWithExactly(buildStub, '/path/to/MySolution.sln');
            sinon.assert.calledOnce(showInfoStub);
        });

        it('should find solution automatically when no item provided', async () => {
            const findFilesStub = sinon.stub(vscode.workspace, 'findFiles')
                .resolves([{ fsPath: '/path/to/MySolution.sln' }] as any);
            const buildStub = sinon.stub(TerminalService, 'buildSolution').resolves({} as any);

            await (solutionCommands as any).buildSolution(undefined);

            sinon.assert.calledOnce(findFilesStub);
            sinon.assert.calledOnceWithExactly(buildStub, '/path/to/MySolution.sln');
        });
    });

    describe('manageSolutionNugetPackages', () => {
        it('should create NuGet manager webview', async () => {
            const mockItem = {
                resourceUri: { fsPath: '/path/to/MySolution.sln' }
            };

            const mockPanel = {
                webview: { html: '' }
            };

            const createPanelStub = sinon.stub(WebviewService, 'createPanel').returns(mockPanel as any);
            const setupMessageHandlingStub = sinon.stub(WebviewService, 'setupMessageHandling');

            await (solutionCommands as any).manageSolutionNugetPackages(mockItem);

            sinon.assert.calledOnce(createPanelStub);
            sinon.assert.calledOnce(setupMessageHandlingStub);
            sinon.assert.match(mockPanel.webview.html.includes('MySolution'), true);
        });
    });

    describe('searchNuGetPackages', () => {
        it('should search packages successfully', async () => {
            const mockResults = [
                {
                    id: 'Newtonsoft.Json',
                    version: '13.0.3',
                    description: 'JSON framework',
                    totalDownloads: 1000000
                }
            ];

            const searchStub = sinon.stub(NuGetService, 'searchPackages').resolves(mockResults);

            const result = await (solutionCommands as any).searchNuGetPackages('json', false);

            sinon.assert.calledOnceWithExactly(searchStub, {
                query: 'json',
                includePrerelease: false,
                take: 20
            });
            sinon.assert.match(result, mockResults);
        });

        it('should return empty array on error', async () => {
            sinon.stub(NuGetService, 'searchPackages').rejects(new Error('Network error'));
            const consoleStub = sinon.stub(console, 'error');

            const result = await (solutionCommands as any).searchNuGetPackages('json', false);

            sinon.assert.calledOnce(consoleStub);
            sinon.assert.match(result, []);
        });
    });

    describe('installPackage', () => {
        it('should install valid package', async () => {
            const validatePackageIdStub = sinon.stub(NuGetService, 'validatePackageId').returns(true);
            const installStub = sinon.stub(TerminalService, 'installPackage').resolves({} as any);
            const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage');

            await (solutionCommands as any).installPackage(
                '/path/to/MySolution.sln',
                'Newtonsoft.Json',
                '13.0.3'
            );

            sinon.assert.calledOnceWithExactly(validatePackageIdStub, 'Newtonsoft.Json');
            sinon.assert.calledOnceWithExactly(
                installStub,
                '/path/to/MySolution.sln',
                'Newtonsoft.Json',
                '13.0.3'
            );
            sinon.assert.calledOnce(showInfoStub);
        });

        it('should reject invalid package ID', async () => {
            const validatePackageIdStub = sinon.stub(NuGetService, 'validatePackageId').returns(false);
            const showErrorStub = sinon.stub(ErrorUtils, 'showError');

            await (solutionCommands as any).installPackage(
                '/path/to/MySolution.sln',
                'invalid package name',
                undefined
            );

            sinon.assert.calledOnceWithExactly(validatePackageIdStub, 'invalid package name');
            sinon.assert.calledOnce(showErrorStub);
        });
    });
});