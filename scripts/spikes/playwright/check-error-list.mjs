// manual-testing.md, "Phase 2.5 (Error List table)": sort, search, code links, double-click to the line; the Warnings toggle also removes the
// markers from the Solution Explorer. The sample's build gives two warnings (CS0168 in Order.cs line 15, CS8602 in PriceCalculator.cs line 9).
// The column filters (the filter icon of Code, Project, File) are not covered yet.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

const ws = prepareWorkspace({});
const { app, win } = await launch(ws);
const frameWith = async selector => {
    for (let i = 0; i < 60; i++) {
        for (const f of win.frames()) if (await f.locator(selector).count().catch(() => 0) > 0) return f;
        await win.waitForTimeout(500);
    }
    throw new Error(`no frame with ${selector}`);
};
try {
    const tree = await openSolutionExplorer(win);
    await win.keyboard.press('Control+Shift+b');
    const dll = join(ws.folder, 'src/Shop.Web/bin/Debug/net10.0/Shop.Web.dll');
    for (let i = 0; i < 90 && !existsSync(dll); i++) await win.waitForTimeout(2000);
    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('Show Error List');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Enter');
    const el = await frameWith('table tbody tr.row');
    const codes = async () => el.locator('tbody tr.row td:nth-child(2)').allInnerTexts();
    const marked = () => tree.locator('.node-name.diagnostic-warning').count();
    // The build's problems arrive a moment after the build ends
    for (let i = 0; i < 20 && (await codes()).length < 2; i++) await win.waitForTimeout(500);

    check('two warnings are listed', (await codes()).length === 2, JSON.stringify(await codes()));
    check('the toolbar counts 2 Warnings', (await el.locator('.toolbar .toggle').allInnerTexts()).some(t => /2 Warnings/.test(t)));
    check('the tree marks the nodes with warnings', await marked() > 0);

    // Sort: a click on the header orders by it, a second click reverses
    await el.getByRole('button', { name: 'Sort by Code' }).click();
    const first = await codes();
    await el.getByRole('button', { name: 'Sort by Code' }).click();
    const second = await codes();
    check('sorting by Code twice reverses the order', first.length === 2 && first[0] === second[1] && first[1] === second[0], JSON.stringify({ first, second }));

    // Search
    await el.getByLabel('Search Error List').fill('unused');
    await win.waitForTimeout(500);
    check('search "unused" leaves CS0168', JSON.stringify(await codes()) === '["CS0168"]', JSON.stringify(await codes()));
    await el.getByLabel('Search Error List').fill('');

    // Code link: the documentation (a link that opens in the browser)
    const link = await el.locator('tbody tr.row a').first().getAttribute('title');
    check('the code is linked to its documentation', /learn\.microsoft\.com.*cs\d+/i.test(link ?? ''), String(link));

    // Double-click opens the file at the line
    await el.locator('tbody tr.row', { hasText: 'CS0168' }).dblclick();
    await win.waitForTimeout(2500);
    check('double-click opens Order.cs', await win.locator('.tab[aria-label*="Order.cs"]').count() > 0);
    check('at line 15', await win.locator('.statusbar').getByText(/Ln 15,/).count() > 0, await win.locator('.statusbar').innerText().then(t => t.replace(/\s+/g, ' ').slice(0, 200)));

    // The Warnings toggle empties the list and takes the markers off the tree
    await el.locator('.toolbar .toggle', { hasText: 'Warnings' }).click();
    await win.waitForTimeout(1500);
    check('Warnings off: the list is empty', (await codes()).length === 0, JSON.stringify(await codes()));
    check('Warnings off: the tree has no markers', await marked() === 0, String(await marked()));
    await el.locator('.toolbar .toggle', { hasText: 'Warnings' }).click();
    await win.waitForTimeout(1500);
    check('Warnings on again: both are back', (await codes()).length === 2 && await marked() > 0);
} finally { await app.close(); }
