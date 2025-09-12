import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WebviewService, WebviewPanelConfig } from '../../../services/webviewService';

describe('WebviewService', () => {
    let createWebviewPanelStub: sinon.SinonStub;
    let mockPanel: any;
    let mockWebview: any;

    beforeEach(() => {
        mockWebview = {
            onDidReceiveMessage: sinon.stub(),
            postMessage: sinon.stub().resolves(true)
        };

        mockPanel = {
            webview: mockWebview
        };

        createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('createPanel', () => {
        it('should create webview panel with default options', () => {
            const config: WebviewPanelConfig = {
                viewType: 'testView',
                title: 'Test Panel',
                showOptions: vscode.ViewColumn.One
            };

            const result = WebviewService.createPanel(config);

            sinon.assert.calledOnceWithExactly(createWebviewPanelStub, 
                'testView',
                'Test Panel', 
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: []
                }
            );
            sinon.assert.match(result, mockPanel);
        });

        it('should create webview panel with custom options', () => {
            const config: WebviewPanelConfig = {
                viewType: 'testView',
                title: 'Test Panel',
                showOptions: vscode.ViewColumn.Two,
                options: {
                    enableScripts: false,
                    retainContextWhenHidden: false
                }
            };

            WebviewService.createPanel(config);

            sinon.assert.calledOnceWithExactly(createWebviewPanelStub,
                'testView',
                'Test Panel',
                vscode.ViewColumn.Two,
                {
                    enableScripts: false,
                    retainContextWhenHidden: false,
                    localResourceRoots: []
                }
            );
        });
    });

    describe('setupMessageHandling', () => {
        it('should set up message handling correctly', () => {
            const messageHandler = sinon.stub();
            const disposables: vscode.Disposable[] = [];

            WebviewService.setupMessageHandling(mockPanel, messageHandler, disposables);

            sinon.assert.calledOnceWithExactly(
                mockWebview.onDidReceiveMessage,
                messageHandler,
                undefined,
                disposables
            );
        });
    });

    describe('postMessage', () => {
        it('should post message to webview', async () => {
            const message = { type: 'test', data: 'hello' };
            
            const result = await WebviewService.postMessage(mockPanel, message);

            sinon.assert.calledOnceWithExactly(mockWebview.postMessage, message);
            sinon.assert.match(result, true);
        });
    });

    describe('generateCSP', () => {
        it('should generate valid CSP string', () => {
            const nonce = 'test-nonce-123';
            
            const result = WebviewService.generateCSP(nonce);

            const expected = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://azuresearch-usnc.nuget.org;`;
            sinon.assert.match(result, expected);
        });
    });

    describe('generateNonce', () => {
        it('should generate nonce of correct length', () => {
            const result = WebviewService.generateNonce();
            
            sinon.assert.match(result.length, 32);
            sinon.assert.match(/^[A-Za-z0-9]+$/.test(result), true);
        });

        it('should generate unique nonces', () => {
            const nonce1 = WebviewService.generateNonce();
            const nonce2 = WebviewService.generateNonce();
            
            sinon.assert.match(nonce1 !== nonce2, true);
        });
    });
});