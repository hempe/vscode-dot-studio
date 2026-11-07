// manual-testing.md, "A failed evaluation is retried" (src/__fixtures__/project-items with an Items.sln and a global.json that pins an SDK that is not installed, so
// every evaluation fails): `Legacy/Old.cs` shows (the disk listing) and the log says `Could not evaluate the items`; deleting global.json within 30 seconds of opening
// (no watcher sees it) makes `Old.cs` disappear by itself at the next retry, at most 2 minutes later. Again with the window reloaded and ItemsApp left collapsed for
// more than 5 minutes (the retries stop after 5 s, 30 s and 2 min, and the last failure holds the next try back for 2 min): after deleting global.json and expanding ItemsApp, `Old.cs` disappears a moment after the tree shows. Takes about 10 minutes.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, openSolutionExplorer, expandPath, rowInfo, sh, repo, check } from './lib.mjs';

const work = mkdtempSync(join(tmpdir(), 'shinobi-pw-'));
const folder = join(work, 'Items');
cpSync(join(repo, 'src/__fixtures__/project-items'), folder, { recursive: true });
const ws = { work, folder };
await sh(ws, 'dotnet new sln -n Items --format sln');
await sh(ws, 'dotnet sln Items.sln add ItemsApp/ItemsApp.csproj');
const pin = join(folder, 'global.json');
const pinSdk = () => writeFileSync(pin, '{"sdk":{"version":"9.9.999","rollForward":"disable"}}');
const logged = () => {
    const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];
    return walk(join(work, 'profile/logs')).filter(f => f.endsWith('.log')).some(f => /Could not evaluate the items/.test(readFileSync(f, 'utf8')));
};
const waitUntil = async (win, fn, seconds) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };

// First start: global.json deleted within 30 seconds, ItemsApp open
pinSdk();
if (!process.env.SKIP_FIRST) {
    const { app, win } = await launch(ws);
    try {
        const tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Items', 'ItemsApp', 'Legacy']);
        await win.waitForTimeout(1500);
        check('Old.cs shows while the evaluation fails (the disk listing)', !!await rowInfo(tree, 'Old.cs'));
        check('the log says it could not evaluate the items', await waitUntil(win, async () => logged(), 20));
        rmSync(pin);
        const gone = await waitUntil(win, async () => !(await rowInfo(tree, 'Old.cs')), 150);
        check('at the next retry Old.cs disappears by itself (at most 2 minutes)', gone);
    } finally { await app.close(); }
}

// Second start: ItemsApp stays collapsed for more than 5 minutes (the retries stop after 5 s, 30 s and 2 min, and the last failure holds the next try back for 2 min)
pinSdk();
{
    const { app, win } = await launch(ws);
    try {
        const tree = await openSolutionExplorer(win);
        await win.waitForTimeout(300000);
        rmSync(pin);
        await expandPath(win, tree, ['Items', 'ItemsApp', 'Legacy']);
        // the disk listing may show Old.cs for a moment; it goes once the evaluation succeeds
        const gone = await waitUntil(win, async () => !(await rowInfo(tree, 'Old.cs')) && !!(await rowInfo(tree, 'Linked')), 40);
        check('after a long collapse and deleting global.json, expanding ItemsApp ends without Old.cs (and with the Linked folder the evaluation brings)', gone, JSON.stringify((await tree.locator('.tree-node').allTextContents()).map(t => t.trim())));
    } finally { await app.close(); }
}
