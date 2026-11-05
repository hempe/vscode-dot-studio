// Helpers to drive the real VS Code through Playwright: a throwaway profile, a copy of the sample solution, the Solution
// Explorer's webview frame. Run a check through run.sh (own Xvfb display).
import { _electron as electron } from 'playwright-core';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

const template = join(tmpdir(), 'shinobi-pw-profile-template');

/** Starts VS Code with this extension (built: npm run build:dev) on the folder; returns { app, win }.
 *  The first run dismisses the welcome dialog and keeps its profile as a template (/tmp/shinobi-pw-profile-template),
 *  later runs start from a copy of it and need no dialog (about 10 s less). */
export async function launch({ work, folder }) {
    const warm = existsSync(template);
    if (warm) cpSync(template, join(work, 'profile'), { recursive: true });
    const app = await electron.launch({
        executablePath: process.env.ELECTRON_BIN ?? '/usr/lib/electron42/electron',
        args: [
            process.env.CODE_MAIN ?? '/usr/lib/code/code.mjs',
            '--disable-gpu', '--no-sandbox', ...(process.env.PW_LOG ? [`--log=${process.env.PW_LOG}`] : []),
            `--user-data-dir=${work}/profile`, `--extensions-dir=${work}/extensions`,
            `--extensionDevelopmentPath=${repo}`,
            '--disable-workspace-trust', '--new-window', folder,
        ],
        env: { ...process.env, WAYLAND_DISPLAY: '' },
        timeout: 60000,
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    if (!warm) {
        // The first-run welcome dialog (sign in to Copilot, then pick a theme) covers the window in a fresh profile
        // (it opens a few seconds after the window, so wait for it)
        for (const name of ['Continue without Signing In', 'Get Started']) {
            const b = win.getByText(name, { exact: true });
            if (await b.waitFor({ timeout: 20000 }).then(() => true, () => false)) await b.click();
        }
        app.once('close', () => { try { cpSync(join(work, 'profile'), template, { recursive: true }); } catch { /* no template then */ } });
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

const rowByName = (frame, name) => frame.locator('.tree-node').filter({ has: frame.locator(`xpath=.//*[normalize-space(.)="${name}"]`) }).first();

/** Expands the rows on a path of names from the top (each name is searched among the visible rows; a collapsed one is opened with Right). */
export async function expandPath(win, frame, names) {
    for (const name of names) {
        const row = rowByName(frame, name);
        await row.waitFor({ timeout: 30000 });
        // A row that is open already is left alone (a click on a selected row can toggle it)
        const collapsed = () => row.locator('.expand-icon').first().evaluate(e => e.style.transform.includes('rotate(0deg)')).catch(() => false);
        if (!await collapsed()) continue;
        // The tree is rebuilt now and then (a setting, a file change): a click on a row that went away is tried again
        for (let attempt = 1; ; attempt++) {
            try { await row.click({ timeout: 4000 }); break; } catch (e) { if (attempt >= 5) throw e; await win.waitForTimeout(1000); }
        }
        if (await collapsed()) { await win.keyboard.press('ArrowRight'); await win.waitForTimeout(600); }
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

/** Waits until the rows have not changed for a while (the tree is rebuilt after a setting or a file change). */
export async function settle(win, frame, quietMs = 2000, timeout = 30000) {
    const snap = () => frame.locator('.tree-node').allTextContents().then(t => t.join('|'), () => '');
    let last = await snap(), since = Date.now();
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        await win.waitForTimeout(300);
        const now = await snap();
        if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
    }
}

/** Closes and opens a row again (its children are read anew). */
export async function reopen(win, frame, name) {
    const row = rowByName(frame, name);
    await row.click();
    await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(400);
    await win.keyboard.press('ArrowRight'); await win.waitForTimeout(800);
}
