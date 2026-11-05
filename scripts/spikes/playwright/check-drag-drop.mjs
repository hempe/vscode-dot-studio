// manual-testing.md, "Drag & drop refusals" and "Drag & drop details", with plain files (no namespace questions, so no C# extension needed):
// refusals do nothing, Dependencies cannot be dragged, hovering a collapsed folder opens it, a selection moves together, an unselected row alone.
// Not covered: the pointer shapes, renaming, the highlight colours, C# namespaces, `.sln`/`.slnx` nodes, macOS keys.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const files = {};
for (const n of ['a', 'b', 'c', 'd']) files[`src/Shop.Web/Docs/${n}.txt`] = n;
files['src/Shop.Web/Target/keep.txt'] = 'keep';
const ws = prepareWorkspace({}, files);
const web = join(ws.folder, 'src/Shop.Web');
const at = p => existsSync(join(web, p));
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web', 'Pages', 'Docs', 'Target']);
    await win.waitForTimeout(1000);
    const row = name => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${name}"]`) }).first();
    const centre = async name => { await row(name).scrollIntoViewIfNeeded(); const b = await row(name).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const drag = async (from, to, { hold = 0 } = {}) => {
        const a = await centre(from);
        await win.mouse.move(a.x, a.y, { steps: 3 });
        await win.mouse.down();
        const b = await centre(to);
        await win.mouse.move(b.x, b.y - 3, { steps: 12 });
        await win.mouse.move(b.x, b.y, { steps: 4 });
        if (hold) await win.waitForTimeout(hold);
        await win.mouse.up();
        await win.waitForTimeout(2000);
    };

    // Refusals
    check('Dependencies cannot be dragged', await row('Dependencies').getAttribute('draggable') === 'false');
    await drag('appsettings.json', 'src');
    check('a file dropped on a solution folder stays', at('appsettings.json'));
    await drag('appsettings.json', 'Dependencies');
    check('a file dropped on Dependencies stays', at('appsettings.json'));
    await drag('Pages', 'Shared');
    check('a folder dropped on its own subfolder stays', at('Pages/Shared') && !at('Pages/Shared/Pages'), String(at('Pages/Shared/Pages')));

    // Hovering a collapsed folder while dragging opens it (0.7 s); the drop then goes to the folder under the mouse
    check('Properties is collapsed', await row('launchSettings.json').count() === 0);
    const a = await centre('appsettings.json');
    await win.mouse.move(a.x, a.y, { steps: 3 });
    await win.mouse.down();
    const p = await centre('Properties');
    await win.mouse.move(p.x, p.y - 3, { steps: 12 });
    await win.mouse.move(p.x, p.y, { steps: 4 });
    await win.waitForTimeout(1500);
    check('hovering it while dragging opens it', await row('launchSettings.json').count() > 0);
    // Cancel: drop on the file's own folder row (Shop.Web), which keeps it where it is
    const w = await centre('Shop.Web');
    await win.mouse.move(w.x, w.y, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1500);

    // A selection moves together: Ctrl+click three, drag one of them
    await row('a.txt').click();
    await win.waitForTimeout(500);
    if ((await tree.locator('.tree-node.selected').count()) !== 1) { await row('a.txt').click(); await win.waitForTimeout(500); }
    await win.keyboard.down('Control');
    await row('b.txt').click();
    await row('c.txt').click();
    await win.keyboard.up('Control');
    await drag('b.txt', 'Target');
    check('three selected files moved into Target', at('Target/a.txt') && at('Target/b.txt') && at('Target/c.txt') && !at('Docs/a.txt') && !at('Docs/b.txt') && !at('Docs/c.txt'));
    check('the fourth stayed', at('Docs/d.txt'));

} catch (e) { await win.screenshot({ path: '/tmp/pw-dd.png' }); throw e; } finally { await app.close(); }


// An unselected row moves alone: a second start, since the tree of the first shows open folders without children after the moves
{
    const ws2 = prepareWorkspace({}, files);
    const { app: app2, win: win2 } = await launch(ws2);
    try {
        const tree = await openSolutionExplorer(win2);
        await expandPath(win2, tree, ['Contoso', 'src', 'Shop.Web', 'Docs']);
        await win2.waitForTimeout(1000);
        const row = name => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${name}"]`) }).first();
        const centre = async name => { const b = await row(name).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
        await row('a.txt').click();
        await win2.waitForTimeout(500);
        const from = await centre('d.txt');
        const to = await centre('wwwroot');
        await win2.mouse.move(from.x, from.y, { steps: 3 });
        await win2.mouse.down();
        await win2.mouse.move(to.x, to.y - 3, { steps: 12 });
        await win2.mouse.move(to.x, to.y, { steps: 4 });
        await win2.waitForTimeout(300);
        await win2.mouse.up();
        await win2.waitForTimeout(2000);
        const there = p => existsSync(join(ws2.folder, 'src/Shop.Web', p));
        check('a row dragged while another is selected moves alone', there('wwwroot/d.txt') && there('Docs/a.txt') && !there('wwwroot/a.txt'));
    } finally { await app2.close(); }
}
