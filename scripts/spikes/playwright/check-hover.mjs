// manual-testing.md, "Solution Explorer hover": the row under the mouse is highlighted (`.tree-node.hovered`), moves with the mouse, goes when the
// mouse leaves the tree and after a drag and drop until the mouse moves again. Not covered: that a large solution feels no slower, and leaving
// into another webview (the Welcome page): there the highlight stays under Playwright's synthetic mouse, which sends no leave to the old frame
// (unconfirmed by hand: move the mouse from a row onto a webview editor and see whether the highlight goes).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const ws = prepareWorkspace({});
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web']);
    await win.waitForTimeout(1000);
    const row = name => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${name}"]`) }).first();
    const hovered = () => tree.locator('.tree-node.hovered').evaluateAll(l => l.map(e => e.textContent.trim()));
    const centre = async name => { const b = await row(name).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const moveTo = async name => { const p = await centre(name); await win.mouse.move(p.x, p.y, { steps: 4 }); await win.waitForTimeout(300); };

    await moveTo('Pages');
    check('the row under the mouse is highlighted', JSON.stringify(await hovered()) === '["Pages"]', JSON.stringify(await hovered()));
    await moveTo('wwwroot');
    check('the highlight moves with the mouse', JSON.stringify(await hovered()) === '["wwwroot"]', JSON.stringify(await hovered()));
    await win.mouse.move(24, 400, { steps: 6 });
    await win.waitForTimeout(300);
    check('it goes when the mouse leaves the tree (to the activity bar)', (await hovered()).length === 0, JSON.stringify(await hovered()));
    await moveTo('wwwroot');
    await win.mouse.move(200, 800, { steps: 6 });
    await win.waitForTimeout(300);
    check('it goes below the last row', (await hovered()).length === 0, JSON.stringify(await hovered()));

    // Drag appsettings.json onto the wwwroot folder
    const from = await centre('appsettings.json');
    const to = await centre('wwwroot');
    await win.mouse.move(from.x, from.y, { steps: 3 });
    await win.mouse.down();
    await win.mouse.move(to.x, to.y - 4, { steps: 12 });
    await win.mouse.move(to.x, to.y, { steps: 4 });
    await win.waitForTimeout(300);
    await win.mouse.up();
    await win.waitForTimeout(2500);
    const moved = existsSync(join(ws.folder, 'src/Shop.Web/wwwroot/appsettings.json'));
    check('the drop moved the file into wwwroot', moved);
    check('after the drop nothing is highlighted', (await hovered()).length === 0, JSON.stringify(await hovered()));
    // The mouse moves again: the highlight returns
    const p = await centre('Pages');
    await win.mouse.move(p.x + 2, p.y, { steps: 3 });
    await win.mouse.move(p.x + 6, p.y + 1, { steps: 3 });
    await win.waitForTimeout(400);
    check('and returns when the mouse moves again', JSON.stringify(await hovered()) === '["Pages"]', JSON.stringify(await hovered()));
} finally { await app.close(); }
