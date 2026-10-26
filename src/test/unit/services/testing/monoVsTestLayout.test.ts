// The Mono runner copy lives where only this user can change it (review A5-3)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyLayout, MONO_VSTEST_VERSION } from '../../../../services/testing/monoVsTest';

(process.platform === 'win32' ? describe.skip : describe)('copyLayout', () => {
    let dir: string;
    let tools: string;
    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-monolayout-')));
        tools = path.join(dir, 'tools');
        fs.mkdirSync(tools);
        fs.writeFileSync(path.join(tools, 'vstest.console.exe'), 'exe');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('copies the tools once into the root and returns the console', () => {
        const root = path.join(dir, 'root');
        fs.mkdirSync(root);
        const consolePath = copyLayout(tools, root);
        expect(consolePath).toBe(path.join(root, `vstest-mono-${MONO_VSTEST_VERSION}`, 'vstest.console.exe'));
        expect(fs.readFileSync(consolePath, 'utf8')).toBe('exe');
        expect(copyLayout(tools, root)).toBe(consolePath);
    });

    it('refuses a copy that other users can change', () => {
        const root = path.join(dir, 'root');
        const target = path.join(root, `vstest-mono-${MONO_VSTEST_VERSION}`);
        fs.mkdirSync(target, { recursive: true });
        fs.chmodSync(target, 0o777);
        expect(() => copyLayout(tools, root)).toThrow(/other users/);
    });
});
