// form-action and base-uri do not fall back to default-src: every HTML shell has to name them (review A3-7)
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const shells = [
    'webview/providers/views/NuGetWebview.ts',
    'webview/providers/views/SolutionWebview.ts',
    'webview/providers/views/TemplateWizardWebview.ts',
    'webview/providers/views/ErrorListWebview.ts',
    'webview/nuget-view/template.html',
    'webview/solution-view/template.html',
];

describe('Content-Security-Policy of the webviews', () => {
    it.each(shells)('%s forbids form submissions and <base>', file => {
        const policy = /Content-Security-Policy" content="([^"]*)"/.exec(fs.readFileSync(path.join(root, file), 'utf8'))?.[1];
        expect(policy).toBeDefined();
        expect(policy).toContain("form-action 'none'");
        expect(policy).toContain("base-uri 'none'");
        expect(policy).toContain("default-src 'none'");
    });
});
