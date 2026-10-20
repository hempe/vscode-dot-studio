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

// Webviews run in a browser: `vscode` and Node's modules don't exist there. A webview that imports one, even
// through shared code, doesn't build ("Can't resolve 'util'") and the views stay empty. Build them for real.
describe('webview bundles build', () => {
    it('without errors', done => {
        // webpack runs in Node; the tests run in jsdom, which lacks these
        (globalThis as any).setImmediate ??= (fn: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
        (globalThis as any).clearImmediate ??= (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);
        const webpack = require('webpack');
        const os = require('os') as typeof import('os');
        const fs = require('fs') as typeof import('fs');
        const configs = require(path.join(__dirname, '../../../../webpack.config.js'));
        const webview = (Array.isArray(configs) ? configs : [configs]).find((config: { name?: string }) => config.name === 'webview');
        const out = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'webview-build-')));
        webpack({ ...webview, mode: 'development', output: { ...webview.output, path: out } }, (error: Error | null, stats: any) => {
            fs.rmSync(out, { recursive: true, force: true });
            expect(error).toBeNull();
            expect(stats.hasErrors() ? stats.toJson({ all: false, errors: true }).errors.map((e: { message: string }) => e.message.split('\n')[0]) : []).toEqual([]);
            done();
        });
    }, 180000);
});
