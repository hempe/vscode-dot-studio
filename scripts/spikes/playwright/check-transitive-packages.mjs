// manual-testing.md, "transitive packages": Shop.Web > Dependencies > Packages > Microsoft.EntityFrameworkCore.Sqlite expands several levels;
// the NuGet manager on the solution shows "Transitive packages (N)" collapsed under the top-level packages, a transitive package is marked
// as such and has no uninstall. Not covered: the manager on a single project, Install adding a direct reference, and the "Transitively
// referenced by" tooltip of a project's version.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const ws = prepareWorkspace({});
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await win.keyboard.press('Control+Shift+b');
    const dll = join(ws.folder, 'src/Shop.Web/bin/Debug/net10.0/Shop.Web.dll');
    for (let i = 0; i < 90 && !existsSync(dll); i++) await win.waitForTimeout(2000);
    await win.waitForTimeout(2000);

    // The tree: the package and the levels below it
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web', 'Dependencies', 'Packages']);
    await win.waitForTimeout(1000);
    await expandPath(win, tree, ['Microsoft.EntityFrameworkCore.Sqlite*']);
    await win.waitForTimeout(1500);
    const rows = await tree.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0, expandable: !!e.querySelector('.expand-icon') })));
    const at = rows.findIndex(r => r.name.startsWith('Microsoft.EntityFrameworkCore.Sqlite'));
    const below = [];
    for (let i = at + 1; at >= 0 && i < rows.length && rows[i].depth > rows[at].depth; i++) below.push(rows[i]);
    check('Sqlite has packages below it', below.length > 0, JSON.stringify(rows.slice(Math.max(at, 0), at + 5)));
    const child = below.find(r => r.expandable);
    check('and one of them expands further', !!child);
    if (child) {
        await expandPath(win, tree, [`${child.name.split(' ')[0]}*`]);
        await win.waitForTimeout(1000);
        const after = await tree.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0 })));
        const ci = after.findIndex(r => r.name === child.name && r.depth > rows[at].depth);
        check('a third level shows', ci >= 0 && after[ci + 1]?.depth > after[ci].depth, JSON.stringify(after.slice(ci, ci + 3)));
    }

    // The NuGet manager for the solution
    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('Open NuGet Package Manager for Solution');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Enter');
    let manager, header;
    for (let i = 0; i < 90 && !header; i++) {
        for (const f of win.frames()) {
            const h = f.getByText(/Transitive packages \(\d+\)/).first();
            if (await h.count().catch(() => 0)) { manager = f; header = h; break; }
        }
        if (!header) await win.waitForTimeout(1000);
    }
    check('the manager lists "Transitive packages (N)"', !!header);
    if (header) {
        check('collapsed at first', await header.getAttribute('aria-expanded') === 'false');
        await header.click();
        await win.waitForTimeout(800);
        check('a click expands it', await header.getAttribute('aria-expanded') === 'true');
        // The packages are the divs after the header
        const items = header.locator('xpath=following-sibling::div');
        const count = await items.count();
        check('it lists packages', count > 0, String(count));
        if (count > 0) {
            await items.first().click();
            await win.waitForTimeout(1500);
            check('the details say it is only referenced through other packages', await manager.getByText(/Only referenced through other packages/).count() > 0);
            check('the list item says it is transitive ("Transitive, in N projects")', await manager.getByText(/Transitive, in \d+ project/).count() > 0);
            check('and offer no uninstall', await manager.getByRole('button', { name: /uninstall|remove/i }).count() === 0 && await manager.getByText(/Remove package from selected projects/).count() === 0);
        }
    }
} finally { await app.close(); }
