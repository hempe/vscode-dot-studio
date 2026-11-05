// Spike: drive code-oss with Playwright (_electron.launch) in a throwaway profile on a copy of the sample solution.
// Run through run.sh (own Xvfb display); needs a built extension (npm run build:dev).
import { _electron as electron } from 'playwright-core';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const work = mkdtempSync(join(tmpdir(), 'shinobi-pw-'));
cpSync(join(repo, 'scripts/screenshots/sample'), join(work, 'Contoso'), { recursive: true });
console.log('work', work, 'DISPLAY', process.env.DISPLAY);

const app = await electron.launch({
    executablePath: process.env.ELECTRON_BIN ?? '/usr/lib/electron42/electron',
    args: [
        process.env.CODE_MAIN ?? '/usr/lib/code/code.mjs',
        '--disable-gpu', '--no-sandbox',
        `--user-data-dir=${work}/profile`, `--extensions-dir=${work}/extensions`,
        `--extensionDevelopmentPath=${repo}`,
        '--disable-workspace-trust', '--new-window', join(work, 'Contoso'),
    ],
    env: { ...process.env, WAYLAND_DISPLAY: '' },
    timeout: 60000,
});
try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(5000);
    // The first-run welcome dialog (sign in to Copilot) covers the window in a fresh profile
    for (const name of ['Continue without Signing In', 'Get Started']) {
        const b = win.getByText(name, { exact: true });
        if (await b.isVisible({ timeout: 3000 }).catch(() => false)) await b.click();
    }
    // The activity bar item toggles the side bar: click it only when the view is not showing yet
    const tab = win.locator('.activitybar [role=tab]:has(a[aria-label="Solution Explorer"])');
    await tab.waitFor({ timeout: 15000 });
    if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
    await win.waitForTimeout(8000);
    console.log('title', await win.title());
    console.log('frames', win.frames().map(f => f.url().slice(0, 100)));
    const tree = win.frames().find(f => f.url().includes('fake.html')) ?? win;
    const rows = tree.locator('[data-vscode-context]');
    await rows.first().waitFor({ timeout: 30000 });
    // Keyboard driven like a user: focus the first row, expand everything below it with Right
    await rows.first().click();
    for (let i = 0; i < 6; i++) { await win.keyboard.press('ArrowRight'); await win.keyboard.press('ArrowDown'); }
    await win.waitForTimeout(1500);
    console.log('rows', await rows.allInnerTexts());
    await win.screenshot({ path: join(work, 'shot.png') });
    console.log('shot', join(work, 'shot.png'));
} finally {
    await app.close();
}
