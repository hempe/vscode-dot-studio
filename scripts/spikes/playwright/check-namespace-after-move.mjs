// manual-testing.md, "Namespaces after Cut/Paste": cut a folder with three C# files and paste it elsewhere: one question (Update All / Review Each /
// Skip), Update All rewrites the namespaces and the references follow (the C# language server's rename, so the C# extension is in the profile);
// Review Each asks per file; a single cut file asks about that file; Copy/Paste asks nothing; renaming a folder asks, and not when the namespaces
// match already. Modal questions are HTML dialogs here (`window.dialogStyle: custom`, set by lib.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const cs = (ns, cls, extra = '') => `namespace ${ns};\n\npublic class ${cls} { ${extra} }\n`;
const inventory = { 'src/Shop.Core/Inventory/A.cs': cs('Shop.Core.Inventory', 'AItem'), 'src/Shop.Core/Inventory/B.cs': cs('Shop.Core.Inventory', 'BItem'), 'src/Shop.Core/Inventory/C.cs': cs('Shop.Core.Inventory', 'CItem') };
const editorconfig = { '.editorconfig': 'root = true\n\n[*.cs]\ndotnet_diagnostic.IDE0130.severity = suggestion\n' };
const uses = { 'src/Shop.Core/Catalog/UsesInventory.cs': `using Shop.Core.Inventory;\n\nnamespace Shop.Core.Catalog;\n\npublic class UsesInventory { public AItem Item = new(); }\n` };

// IDE0130 (the namespace does not match the folder) is an analyzer diagnostic: without a full-solution scope the server reports it for open files only
const settings = { 'dotnet.backgroundAnalysis.analyzerDiagnosticsScope': 'fullSolution', 'dotnet.backgroundAnalysis.compilerDiagnosticsScope': 'fullSolution' };

async function session(name, files, run) {
    console.log(name);
    const ws = prepareWorkspace(settings, files);
    const { app, win } = await launch(ws, { csharp: true });
    try {
        const tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core']);
        await win.waitForTimeout(20000); // the language server loads the projects
        const row = n => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).first();
        const select = async n => { await row(n).click(); await win.waitForTimeout(1000); };
        const dialog = () => win.locator('.monaco-dialog-box');
        const dialogText = async () => { await dialog().waitFor({ timeout: 20000 }); return (await dialog().innerText()).replace(/\s+/g, ' '); };
        const buttons = () => dialog().locator('.dialog-buttons a, .dialog-buttons .monaco-button, .dialog-buttons button').allInnerTexts();
        const read = p => readFileSync(join(ws.folder, 'src/Shop.Core', p), 'utf8');
        await run({ win, tree, row, select, dialog, dialogText, buttons, read, ws });
    } finally { await app.close(); }
}

await session('cut a folder, Update All', { ...inventory, ...uses, ...editorconfig }, async ({ win, select, dialog, dialogText, buttons, read }) => {
    await select('Inventory');
    await win.keyboard.press('Control+x');
    await win.waitForTimeout(800);
    await select('Orders');
    await win.keyboard.press('Control+v');
    const text = await dialogText();
    check('one question for the three files', /3 C# files have a namespace that does not match their new folder/.test(text), text);
    const names = await buttons();
    check('with Update All, Review Each and Skip', ['Update All', 'Review Each', 'Skip'].every(b => names.includes(b)), JSON.stringify(names));
    await win.getByRole('button', { name: 'Update All' }).click().catch(async () => dialog().getByText('Update All').click());
    // The rename goes through the language server: wait for the files
    for (let i = 0; i < 60 && !/Shop\.Core\.Orders\.Inventory/.test(read('Orders/Inventory/C.cs')); i++) await win.waitForTimeout(1000);
    check('all three files have the new namespace', ['A', 'B', 'C'].every(n => /namespace Shop\.Core\.Orders\.Inventory;/.test(read(`Orders/Inventory/${n}.cs`))), read('Orders/Inventory/A.cs'));
    // Not covered: the files that use them following (the server offers no "Change namespace" fix in this run, see the README)
});

await session('cut a folder, Review Each', { ...inventory, ...editorconfig }, async ({ win, select, dialog, dialogText, buttons, read }) => {
    await select('Inventory');
    await win.keyboard.press('Control+x');
    await win.waitForTimeout(800);
    await select('Orders');
    await win.keyboard.press('Control+v');
    await dialogText();
    await dialog().getByText('Review Each').click();
    const seen = [];
    // The per-file questions are notifications with Update / Skip / Skip All Remaining
    for (let i = 0; i < 3; i++) {
        const toast = win.locator('.notification-toast', { hasText: /Update namespace in/ }).first();
        await toast.waitFor({ timeout: 30000 });
        const text = (await toast.innerText()).replace(/\s+/g, ' ');
        seen.push(text);
        await toast.getByRole('button', { name: i === 1 ? 'Skip' : 'Update', exact: true }).click();
        await win.waitForTimeout(2500);
    }
    check('Review Each asks once per file', seen.length === 3 && seen.every((t, i) => t.includes(`Update namespace in '${'ABC'[i]}.cs'?`)), JSON.stringify(seen.map(t => t.slice(-90))));
    await win.waitForTimeout(3000);
    check('A.cs and C.cs were updated, B.cs was skipped', /Shop\.Core\.Orders\.Inventory/.test(read('Orders/Inventory/A.cs')) && /Shop\.Core\.Orders\.Inventory/.test(read('Orders/Inventory/C.cs')) && /namespace Shop\.Core\.Inventory;/.test(read('Orders/Inventory/B.cs')));
});

await session('a single file, Skip; a copy asks nothing', { 'src/Shop.Core/Single/S.cs': cs('Shop.Core.Single', 'SItem'), ...editorconfig }, async ({ win, tree, row, select, dialog, dialogText, buttons, read }) => {
    await expandPath(win, tree, ['Single']);
    await select('S.cs');
    await win.keyboard.press('Control+x');
    await win.waitForTimeout(800);
    await select('Catalog');
    await win.keyboard.press('Control+v');
    const text = await dialogText();
    check('a single cut file asks about that file', /Update namespace in 'S\.cs'\?/.test(text), text);
    check('with Update Namespace and Skip', JSON.stringify(await buttons()).includes('Update Namespace') && JSON.stringify(await buttons()).includes('Skip'), JSON.stringify(await buttons()));
    await dialog().getByText('Skip').click();
    await win.waitForTimeout(1500);
    check('Skip leaves the namespace', /namespace Shop\.Core\.Single;/.test(read('Catalog/S.cs')));
    // Copy and paste asks nothing
    await select('Product.cs').catch(() => {});
    await expandPath(win, tree, ['Catalog']);
    await select('Product.cs');
    await win.keyboard.press('Control+c');
    await win.waitForTimeout(800);
    await select('Pricing');
    await win.keyboard.press('Control+v');
    await win.waitForTimeout(5000);
    check('copy and paste asks nothing', await dialog().count() === 0);
});

await session('renaming a folder', { 'src/Shop.Core/Match/M.cs': cs('Shop.Core.Matched', 'MItem'), ...editorconfig }, async ({ win, tree, select, dialog, dialogText, read }) => {
    const rename = async (from, to) => {
        await select(from);
        await win.keyboard.press('F2');
        await win.waitForTimeout(800);
        await win.keyboard.press('Control+a');
        await win.keyboard.type(to);
        await win.keyboard.press('Enter');
    };
    // The namespaces match the new name already: no question
    await rename('Match', 'Matched');
    await win.waitForTimeout(6000);
    check('a rename that fits the namespaces asks nothing', await dialog().count() === 0);
    // Catalog's files say Shop.Core.Catalog
    await rename('Catalog', 'Products');
    const text = await dialogText();
    check('a rename that does not fit asks the same question', /2 C# files have a namespace that does not match their new folder/.test(text), text);
    await dialog().getByText('Skip', { exact: true }).click();
    await win.waitForTimeout(1500);
    check('Skip leaves the namespaces', /namespace Shop\.Core\.Catalog;/.test(read('Products/Product.cs')));
});
