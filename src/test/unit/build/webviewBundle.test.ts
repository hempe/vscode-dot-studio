import * as path from 'path';

// The webview HTML shells forbid eval in their Content Security Policy (script-src with a nonce only),
// so the webview bundles must not be built with an eval source map: the views would stay empty
describe('webview bundles', () => {
    it('are built without eval', () => {
        const configs = require(path.join(__dirname, '../../../../webpack.config.js'));
        const webview = (Array.isArray(configs) ? configs : [configs]).find((config: { name?: string }) => config.name === 'webview');
        expect(webview).toBeDefined();
        expect(String(webview.devtool)).not.toMatch(/eval/);
    });
});
