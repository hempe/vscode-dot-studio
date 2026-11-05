// Helpers to drive the real VS Code through Playwright: a throwaway profile, a copy of the sample solution, the Solution
// Explorer's webview frame. Run a check through run.sh (own Xvfb display).
import { _electron as electron } from 'playwright-core';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const repo = resolve(import.meta.dirname, '../../..');

/** Copy of the sample (Contoso) in /tmp with the given workspace settings and extra files (path below the folder -> text). */
export function prepareWorkspace(settings = {}, files = {}) {
    const work = mkdtempSync(join(tmpdir(), 'shinobi-pw-'));
    const folder = join(work, 'Contoso');
    cpSync(join(repo, 'scripts/screenshots/sample'), folder, { recursive: true });
    mkdirSync(join(folder, '.vscode'), { recursive: true });
    writeFileSync(join(folder, '.vscode/settings.json'), JSON.stringify(settings, null, 2));
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(folder, path, '..'), { recursive: true });
        writeFileSync(join(folder, path), text);
    }
    return { work, folder };
}

/** Starts VS Code with this extension (built: npm run build:dev) on the folder; returns { app, win }. */
export async function launch({ work, folder }) {
    const app = await electron.launch({
        executablePath: process.env.ELECTRON_BIN ?? '/usr/lib/electron42/electron',
        args: [
            process.env.CODE_MAIN ?? '/usr/lib/code/code.mjs',
            '--disable-gpu', '--no-sandbox',
            `--user-data-dir=${work}/profile`, `--extensions-dir=${work}/extensions`,
            `--extensionDevelopmentPath=${repo}`,
            '--disable-workspace-trust', '--new-window', folder,
        ],
        env: { ...process.env, WAYLAND_DISPLAY: '' },
        timeout: 60000,
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // The first-run welcome dialog (sign in to Copilot, then pick a theme) covers the window in a fresh profile
    // (it opens a few seconds after the window, so wait for it)
    for (const name of ['Continue without Signing In', 'Get Started']) {
        const b = win.getByText(name, { exact: true });
        if (await b.waitFor({ timeout: 20000 }).then(() => true, () => false)) await b.click();
    }
    return { app, win };
}

/** Shows the Solution Explorer and returns the frame of its webview. */
export async function openSolutionExplorer(win) {
    // The activity bar item toggles the side bar: click it only when it is not open yet
    const tab = win.locator('.activitybar [role=tab]:has(a[aria-label="Solution Explorer"])');
    await tab.waitFor({ timeout: 15000 });
    if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
    for (let i = 0; i < 60; i++) {
        const frame = win.frames().find(f => f.url().includes('fake.html'));
        if (frame && await frame.locator('[data-vscode-context]').count().catch(() => 0) > 0) return frame;
        await win.waitForTimeout(500);
    }
    await win.screenshot({ path: '/tmp/pw-fail.png' });
    throw new Error('the Solution Explorer did not show any rows');
}

/** The rows of the tree as { name, depth }, from the DOM. */
export async function rows(frame) {
    return frame.locator('[data-vscode-context]').evaluateAll(list => list.map(e => ({
        name: e.textContent.trim(),
        depth: Math.round(parseFloat(getComputedStyle(e).paddingLeft) || parseFloat(e.style.paddingLeft) || 0),
        html: e.outerHTML.slice(0, 200),
    })));
}

/** Focus the first row and expand the whole tree with the keyboard: Right, Down for every row. */
export async function expandAll(win, frame, steps = 120) {
    await frame.locator('[data-vscode-context]').first().click();
    for (let i = 0; i < steps; i++) { await win.keyboard.press('ArrowRight'); await win.keyboard.press('ArrowDown'); }
    await win.waitForTimeout(1000);
}

export function check(name, ok, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` ${detail}`}`);
    if (!ok) process.exitCode = 1;
}

const rowByName = (frame, name) => frame.locator('.tree-node').filter({ has: frame.locator(`xpath=.//*[normalize-space(text())="${name}"]`) }).first();

/** Expands the rows on a path of names from the top (each name is searched among the visible rows; a collapsed one is opened with Right). */
export async function expandPath(win, frame, names) {
    for (const name of names) {
        const row = rowByName(frame, name);
        await row.waitFor({ timeout: 30000 });
        await row.click();
        const collapsed = await row.locator('.expand-icon').first().evaluate(e => e.style.transform.includes('rotate(0deg)')).catch(() => false);
        if (collapsed) { await win.keyboard.press('ArrowRight'); await win.waitForTimeout(600); }
    }
}

/** { depth, expandable } of the visible row with this name, or null. */
export async function rowInfo(frame, name) {
    const row = rowByName(frame, name);
    if (await row.count() === 0) return null;
    return row.evaluate(e => ({
        depth: parseFloat(getComputedStyle(e).paddingLeft) || 0,
        expandable: (e.querySelector('.expand-icon')?.style.visibility ?? '') !== 'hidden' && !!e.querySelector('.expand-icon'),
    }));
}
