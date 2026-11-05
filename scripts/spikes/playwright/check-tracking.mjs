// manual-testing.md, "the new settings": `trackActiveItem` follows the editor without stealing the focus; Ctrl+Alt+L focuses the Solution Explorer.
import { prepareWorkspace, launch, openSolutionExplorer, settle, check } from './lib.mjs';

const ws = prepareWorkspace({ 'shinobi.solutionExplorer.trackActiveItem': true });
const { app, win } = await launch(ws);
const openFile = async name => {
    await win.keyboard.press('Control+p');
    await win.keyboard.type(name);
    await win.waitForTimeout(800);
    await win.keyboard.press('Enter');
    await win.waitForTimeout(1500);
};
try {
    const f = await openSolutionExplorer(win);
    const state = async name => f.locator('.tree-node').filter({ has: f.locator(`xpath=.//*[normalize-space(text())="${name}"]`) }).first()
        .evaluate(e => e.className.split(/\s+/)).catch(() => null);
    const selectedRows = () => f.locator('.tree-node.selected').allTextContents();
    const editorFocused = () => win.locator('.monaco-editor.focused').count().then(n => n > 0);

    await openFile('Program.cs src/Shop.Web');
    await settle(win, f, 1500);
    console.log('selected after Program.cs:', await selectedRows());
    check('Program.cs of Shop.Web is selected in the tree', (await selectedRows()).some(t => t.includes('Program.cs')), JSON.stringify(await state('Program.cs')));
    check('the editor kept the focus', await editorFocused());

    await openFile('Index.cshtml.cs');
    await settle(win, f, 1500);
    console.log('selected after Index.cshtml.cs:', await selectedRows());
    check('Index.cshtml.cs (nested, revealed) is selected', (await selectedRows()).some(t => t.includes('Index.cshtml.cs')));
    check('the editor kept the focus', await editorFocused());

    await win.keyboard.press('Control+Alt+l');
    await win.waitForTimeout(1000);
    check('Ctrl+Alt+L focuses the Solution Explorer', await f.evaluate(() => document.hasFocus()) && !(await editorFocused()));
    await win.screenshot({ path: '/tmp/pw-tracking.png' });
} finally { await app.close(); }

// Off (the default): opening a file leaves the tree alone
{
    const off = prepareWorkspace({});
    const { app: app2, win: win2 } = await launch(off);
    try {
        const f = await openSolutionExplorer(win2);
        await win2.keyboard.press('Control+p');
        await win2.keyboard.type('Program.cs src/Shop.Web');
        await win2.waitForTimeout(800);
        await win2.keyboard.press('Enter');
        await settle(win2, f, 2500);
        check('trackActiveItem off: the tree selects nothing', (await f.locator('.tree-node.selected').count()) === 0);
    } finally { await app2.close(); }
}
