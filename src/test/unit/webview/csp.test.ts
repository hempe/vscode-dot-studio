// form-action and base-uri do not fall back to default-src: every HTML shell has to name them (review A3-7)
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const shells = [
    'webview/providers/views/NuGetWebview.ts',
    'webview/providers/views/SolutionWebview.ts',
    'webview/providers/views/TemplateWizardWebview.ts',
    'webview/providers/views/ErrorListWebview.ts',
];

describe('Content-Security-Policy of the webviews', () => {
    it.each(shells)('%s forbids form submissions and <base>', file => {
        const policy = /Content-Security-Policy" content="([^"]*)"/.exec(fs.readFileSync(path.join(root, file), 'utf8'))?.[1];
        expect(policy).toBeDefined();
        expect(policy).toContain("form-action 'none'");
        expect(policy).toContain("base-uri 'none'");
        expect(policy).toContain("default-src 'none'");
        expect(policy).not.toContain('unsafe-eval');
    });
});

describe('nonce of the webview shells', () => {
    it('is random per page and long enough to be unguessable', () => {
        const { getNonce } = require('../../../webview/providers/views/nonce');
        const nonces = new Set(Array.from({ length: 50 }, () => getNonce()));
        expect(nonces.size).toBe(50);
        for (const nonce of nonces) {
            expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
        }
    });
});
