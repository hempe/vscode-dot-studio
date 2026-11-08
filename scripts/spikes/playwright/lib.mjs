// Helpers to drive the real VS Code through Playwright: a throwaway profile, a copy of the sample solution, the Solution
// Explorer's webview frame. Run a check through run.sh (own Xvfb display).
import { _electron as electron } from 'playwright-core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
 *  { csharp: true } adds the C# extension (the language server takes a while to start). The first run dismisses the welcome dialog and keeps its profile as a template (/tmp/shinobi-pw-profile-template),
 *  later runs start from a copy of it and need no dialog (about 10 s less). */
export async function launch({ work, folder }, { csharp = false, userSettings = {} } = {}) {
    if (csharp) {
        // The installed C# extension (and the .NET runtime extension it needs) are linked into the profile's extensions folder, as capture.sh does
        mkdirSync(join(work, 'extensions'), { recursive: true });
        for (const [dir, prefix] of [['.vscode-oss', 'muhammad-sammy.csharp-'], ['.vscode', 'ms-dotnettools.csharp-'], ['.vscode-oss', 'ms-dotnettools.vscode-dotnet-runtime-'], ['.vscode', 'ms-dotnettools.vscode-dotnet-runtime-']]) {
            const root = join(homedir(), dir, 'extensions');
            const found = existsSync(root) ? readdirSync(root).filter(n => n.startsWith(prefix)).sort().pop() : undefined;
            if (found && !existsSync(join(work, 'extensions', found))) symlinkSync(join(root, found), join(work, 'extensions', found));
        }
    }
    const warm = existsSync(template);
    if (warm) cpSync(template, join(work, 'profile'), { recursive: true });
    // Modal questions (Update All / Skip) must be in the page, not native dialogs that Playwright cannot see
    mkdirSync(join(work, 'profile/User'), { recursive: true });
    // Context menus, the open/save dialogs and the terminal drawn in the page, where Playwright reaches them
    writeFileSync(join(work, 'profile/User/settings.json'), JSON.stringify({
        'window.dialogStyle': 'custom',
        'window.menuStyle': 'custom',
        'files.simpleDialog.enable': true,
        'terminal.integrated.gpuAcceleration': 'off',
        ...userSettings,
    }, null, 2));
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

// A name ending in * matches the start of the row's text (a package row carries its version)
export const rowByName = (frame, name) => frame.locator('.tree-node').filter({ has: frame.locator(name.endsWith('*') ? `xpath=.//*[starts-with(normalize-space(.), "${name.slice(0, -1)}")]` : `xpath=.//*[normalize-space(.)="${name}"]`) }).first();

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
        // A file with nested files opens in an editor on a click, which takes the keys: its chevron opens it
        if (await collapsed()) { await row.locator('.expand-icon').first().click(); await win.waitForTimeout(600); }
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

/** Gives the run its own HOME (the user's NuGet.Config, the package cache) so nothing of the real one is read or written; call before launch(). */
export function isolateHome(ws) {
    process.env.HOME = join(ws.work, 'home');
    mkdirSync(process.env.HOME, { recursive: true });
    return process.env.HOME;
}

/** Runs a shell command in the workspace folder, without blocking (a feed served by this process keeps answering) (with the isolated HOME when isolateHome was called); returns the output, also of a failing command. */
export async function sh(ws, command) {
    try { return (await promisify(exec)(command, { cwd: ws.folder, encoding: 'utf8', env: process.env })).stdout; } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}`; }
}

/** The frame (webview) whose text matches, waiting for it. */
export async function findFrame(win, pattern, seconds = 60) {
    for (let i = 0; i < seconds * 2; i++) {
        for (const f of win.frames()) {
            if (!f.url().includes('fake.html')) continue; // the webviews' content frames, not the workbench
            const text = await f.locator('body').innerText({ timeout: 1000 }).catch(() => '');
            if (pattern.test(text)) return f;
        }
        await win.waitForTimeout(500);
    }
    return undefined;
}

/** Opens the NuGet manager for the solution (palette) and returns its frame once the tabs are there. */
export async function openNuGetManager(win) {
    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('Open NuGet Package Manager for Solution');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Enter');
    return findFrame(win, /Browse\s+Installed\s+Updates/);
}

/** A minimal NuGet V3 feed over a folder of Id.Version.nupkg files (search, registration, flat container); read per request, so a package packed later shows up. Returns { url, close }. */
export async function startFeed(dir) {
    const { createServer } = await import('node:http');
    const { readdirSync: ls, readFileSync: read } = await import('node:fs');
    const packages = () => ls(dir).map(f => /^(.+?)\.(\d+\.\d+\.\d+(?:-[\w.]+)?)\.nupkg$/.exec(f)).filter(Boolean).map(m => ({ id: m[1], version: m[2], file: join(dir, m[0]) }));
    const versions = id => packages().filter(p => p.id.toLowerCase() === id.toLowerCase()).map(p => p.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const base = `http://127.0.0.1:${server.address().port}`;
        const json = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        let m;
        if (url.pathname === '/v3/index.json') {
            return json({ version: '3.0.0', resources: [
                { '@id': `${base}/search`, '@type': 'SearchQueryService' },
                { '@id': `${base}/reg/`, '@type': 'RegistrationsBaseUrl/3.6.0' },
                { '@id': `${base}/flat/`, '@type': 'PackageBaseAddress/3.0.0' },
            ] });
        }
        if (url.pathname === '/search') {
            const q = (url.searchParams.get('q') ?? '').toLowerCase();
            const ids = [...new Set(packages().map(p => p.id))].filter(id => id.toLowerCase().includes(q));
            return json({ totalHits: ids.length, data: ids.map(id => { const v = versions(id); return { id, version: v.at(-1), description: `${id} from the private feed`, authors: ['Me'], versions: v.map(version => ({ version })), totalDownloads: 1, verified: false }; }) });
        }
        if ((m = /^\/reg\/([^/]+)\/index\.json$/.exec(url.pathname))) {
            const v = versions(m[1]);
            if (!v.length) { res.statusCode = 404; return res.end(); }
            const id = packages().find(p => p.id.toLowerCase() === m[1].toLowerCase()).id;
            return json({ count: 1, items: [{ '@id': `${base}/reg/${m[1]}/page`, count: v.length, lower: v[0], upper: v.at(-1), items: v.map(version => ({
                '@type': 'Package', catalogEntry: { '@type': ['PackageDetails'], id, version, authors: 'Me', description: `${id} from the private feed`, listed: true }, packageContent: `${base}/flat/${m[1]}/${version}/${m[1]}.${version}.nupkg` })) }] });
        }
        if ((m = /^\/flat\/([^/]+)\/index\.json$/.exec(url.pathname))) return json({ versions: versions(m[1]) });
        if ((m = /^\/flat\/([^/]+)\/([^/]+)\/.+\.nupkg$/.exec(url.pathname))) {
            const p = packages().find(x => x.id.toLowerCase() === m[1].toLowerCase() && x.version === m[2]);
            if (p) { res.setHeader('content-type', 'application/octet-stream'); return res.end(read(p.file)); }
        }
        res.statusCode = 404; res.end();
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}/v3/index.json`, close: () => server.close() };
}


/** Right-clicks the row and picks the menu item; `path` are the labels from the menu down through its submenus. */
export async function contextMenu(win, frame, name, path) {
    await rowByName(frame, name).click({ button: 'right' });
    await pickMenu(win, path);
}

/** Picks an item of the open context menu (labels down through submenus) */
export async function pickMenu(win, path) {
    try {
        await pickMenuItems(win, path);
    } catch (e) {
        // A menu left open would catch the next clicks
        for (let i = 0; i < path.length + 1; i++) await win.keyboard.press('Escape');
        throw e;
    }
}

async function pickMenuItems(win, path) {
    for (const [i, label] of path.entries()) {
        const item = win.locator('.context-view .monaco-menu .action-item').filter({ has: win.locator('.action-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).last();
        await item.waitFor({ timeout: 8000 });
        // A menu ignores a click that comes right after it opened (the mouse-up of the right-click)
        await win.waitForTimeout(600);
        await item.hover();
        await win.waitForTimeout(i < path.length - 1 ? 600 : 200);
        if (i === path.length - 1) {
            const box = await item.boundingBox();
            await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
    }
}

/** The labels of the row's context menu (separators left out); the menu is closed again */
export async function menuLabels(win, frame, name, submenu) {
    await rowByName(frame, name).click({ button: 'right' });
    await win.locator('.context-view .monaco-menu').first().waitFor({ timeout: 8000 });
    if (submenu) {
        await win.locator('.context-view .monaco-menu .action-item').filter({ has: win.locator('.action-label', { hasText: submenu }) }).first().hover();
        await win.waitForTimeout(600);
    }
    const menus = win.locator('.context-view .monaco-menu');
    const labels = (await menus.last().locator('.action-label').allTextContents()).map(t => t.trim()).filter(Boolean);
    await win.keyboard.press('Escape');
    if (submenu) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    return labels;
}

/** Runs a command from the palette by its title (typed, then the first match) */
export async function runCommand(win, title) {
    await win.keyboard.press('Control+Shift+p');
    await win.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 8000 });
    await win.keyboard.type(title);
    await win.waitForTimeout(900);
    await win.keyboard.press('Enter');
}

/** The open quick pick (also input boxes and the simple file dialog), or undefined after the wait */
export async function quickInput(win, seconds = 15) {
    const widget = win.locator('.quick-input-widget');
    for (let i = 0; i < seconds * 4; i++) {
        if (await widget.isVisible().catch(() => false)) return widget;
        await win.waitForTimeout(250);
    }
    return undefined;
}

/** The rows the open quick pick shows (label with description) */
export async function quickItems(win) {
    const widget = await quickInput(win);
    if (!widget) return [];
    await win.waitForTimeout(300);
    // label, description and detail with spaces between them
    return widget.locator('.quick-input-list .monaco-list-row').evaluateAll(rows => rows.map(row => ['.label-name', '.label-description', '.quick-input-list-label-meta, .quick-input-list-detail']
        .map(selector => row.querySelector(selector)?.textContent?.trim() ?? '').filter(Boolean).join(' ') || row.textContent.trim()));
}

/** Picks the quick pick row whose text matches (clicked), waiting for it */
export async function pickQuick(win, pattern, seconds = 15) {
    const widget = await quickInput(win, seconds);
    if (!widget) throw new Error(`no quick pick to pick ${pattern}`);
    const row = widget.locator('.quick-input-list .monaco-list-row').filter({ hasText: pattern }).first();
    await row.waitFor({ timeout: seconds * 1000 });
    await row.click();
}

/** Types into the open quick input (input box, file dialog) and presses Enter */
export async function answerInput(win, text, seconds = 15) {
    const widget = await quickInput(win, seconds);
    if (!widget) throw new Error(`no input box for ${text}`);
    const box = widget.locator('.quick-input-box input');
    await box.fill(text);
    await win.waitForTimeout(400);
    await box.press('Enter');
}

/** The text of the visible notification toasts */
export async function toasts(win) {
    return (await win.locator('.notification-toast').allInnerTexts().catch(() => [])).map(t => t.replace(/\s+/g, ' ').trim());
}

/** Waits for a notification whose text matches; returns its locator (or undefined) */
export async function waitForToast(win, pattern, seconds = 30) {
    for (let i = 0; i < seconds * 2; i++) {
        const toast = win.locator('.notification-toast').filter({ hasText: pattern }).first();
        if (await toast.count()) return toast;
        await win.waitForTimeout(500);
    }
    return undefined;
}

/** Closes every notification toast */
export async function clearToasts(win) {
    await win.keyboard.press('Escape');
    for (const close of await win.locator('.notification-toast .codicon-notifications-clear, .notification-toast .codicon-close').all()) await close.click().catch(() => {});
}

/** The open modal dialog (window.dialogStyle custom): its message and a function to press one of its buttons */
export async function modal(win, seconds = 15) {
    const box = win.locator('.monaco-dialog-box');
    for (let i = 0; i < seconds * 4; i++) {
        if (await box.isVisible().catch(() => false)) {
            const text = (await box.innerText()).replace(/\s+/g, ' ').trim();
            return { text, press: async label => { await box.getByRole('button', { name: label, exact: true }).click(); await win.waitForTimeout(500); } };
        }
        await win.waitForTimeout(250);
    }
    return undefined;
}

/** The text of the visible terminal (the DOM renderer: terminal.integrated.gpuAcceleration off) */
export async function terminalText(win) {
    return (await win.locator('.terminal-wrapper.active .xterm-rows, .terminal .xterm-rows').allInnerTexts().catch(() => [])).join('\n');
}

/** The titles of the open editor tabs */
export async function editorTabs(win) {
    return (await win.locator('.tabs-container .tab .label-name').allTextContents()).map(t => t.trim());
}

/** Runs a part of a check; an exception counts as a failed check (with its first line) instead of ending the run */
export async function part(name, fn) {
    try { await fn(); } catch (e) { check(`${name}: ran through`, false, String(e?.message ?? e).split('\n')[0]); }
}

/** Makes the Contoso sample a .sln with the solution folders src (Shop.*) and tests (the test projects) instead of the .slnx */
export async function toSln(ws) {
    const { rmSync } = await import('node:fs');
    rmSync(join(ws.folder, 'Contoso.slnx'));
    await sh(ws, 'dotnet new sln -n Contoso --format sln');
    await sh(ws, 'dotnet sln Contoso.sln add --solution-folder src src/Shop.Core/Shop.Core.csproj src/Shop.Generators/Shop.Generators.csproj src/Shop.Web/Shop.Web.csproj src/Shop.Worker/Shop.Worker.csproj');
    await sh(ws, 'dotnet sln Contoso.sln add --solution-folder tests tests/Shop.Core.Tests/Shop.Core.Tests.csproj tests/Shop.Core.NUnitTests/Shop.Core.NUnitTests.csproj tests/Shop.Core.XUnit2Tests/Shop.Core.XUnit2Tests.csproj');
}

/** Starts a rename in the tree (the row's Rename menu item), types the name and presses Enter */
export async function renameRow(win, frame, name, newName) {
    await contextMenu(win, frame, name, ['Rename']);
    const input = frame.locator('input[type="text"]').first();
    await input.waitFor({ timeout: 8000 });
    await input.fill(newName);
    await input.press('Enter');
    await win.waitForTimeout(1500);
}

/** The rows with this name, in tree order, each with its indentation (to tell apart rows of the same name) */
export async function rowsNamed(frame, name) {
    const all = frame.locator('.tree-node').filter({ has: frame.locator(`xpath=.//*[normalize-space(.)="${name}"]`) });
    const count = await all.count();
    const out = [];
    for (let i = 0; i < count; i++) {
        const locator = all.nth(i);
        out.push({ locator, depth: await locator.evaluate(e => parseFloat(getComputedStyle(e).paddingLeft) || 0) });
    }
    return out;
}

/** Right-clicks the given row (a locator) and picks the menu item */
export async function contextMenuOn(win, row, path) {
    await row.click({ button: 'right' });
    await pickMenu(win, path);
}
