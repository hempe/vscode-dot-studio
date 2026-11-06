// manual-testing.md, "Drag & drop of files": a C# file dragged onto a folder of another project moves and asks about the new namespace; dropped on a
// file it goes into that file's folder; with Ctrl held it is copied and nothing is asked; a folder with several C# files asks once.
// Needs the C# extension in the profile (the namespace questions). Not covered: the pointer shape and highlight, macOS keys.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const cs = (ns, cls) => `namespace ${ns};\n\npublic class ${cls} { }\n`;
const files = {
    'src/Shop.Core/Single/S.cs': cs('Shop.Core.Single', 'SItem'),
    'src/Shop.Core/Inventory/A.cs': cs('Shop.Core.Inventory', 'AItem'),
    'src/Shop.Core/Inventory/B.cs': cs('Shop.Core.Inventory', 'BItem'),
    'src/Shop.Core/Inventory/C.cs': cs('Shop.Core.Inventory', 'CItem'),
};

async function session(name, run) {
    console.log(name);
    const ws = prepareWorkspace({}, files);
    const { app, win } = await launch(ws, { csharp: true });
    try {
        const tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core', 'Single', 'Inventory', 'Shop.Web', 'Pages']);
        await win.waitForTimeout(20000);
        const row = n => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).first();
        const centre = async n => { await row(n).scrollIntoViewIfNeeded(); const b = await row(n).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
        const drag = async (from, to, { ctrl = false } = {}) => {
            const a = await centre(from);
            await win.mouse.move(a.x, a.y, { steps: 3 });
            await win.mouse.down();
            const b = await centre(to);
            await win.mouse.move(b.x, b.y - 3, { steps: 12 });
            await win.mouse.move(b.x, b.y, { steps: 4 });
            await win.waitForTimeout(300);
            if (ctrl) await win.keyboard.down('Control');
            await win.mouse.up();
            if (ctrl) await win.keyboard.up('Control');
            await win.waitForTimeout(2000);
        };
        const dialog = () => win.locator('.monaco-dialog-box');
        const dialogText = async () => { await dialog().waitFor({ timeout: 20000 }); return (await dialog().innerText()).replace(/\s+/g, ' '); };
        const has = p => existsSync(join(ws.folder, 'src', p));
        const read = p => readFileSync(join(ws.folder, 'src', p), 'utf8');
        await run({ win, drag, dialog, dialogText, has, read });
    } finally { await app.close(); }
}

await session('a file onto a folder of another project', async ({ win, drag, dialog, dialogText, has, read }) => {
    await drag('S.cs', 'Pages');
    check('the file moved into Shop.Web/Pages', has('Shop.Web/Pages/S.cs') && !has('Shop.Core/Single/S.cs'));
    const text = await dialogText();
    check('one question offers the new namespace', /Update namespace in 'S\.cs'\?/.test(text) && /Shop\.Web\.Pages/.test(text), text);
    await dialog().getByRole('button', { name: 'Update Namespace' }).click();
    for (let i = 0; i < 40 && !/Shop\.Web\.Pages/.test(read('Shop.Web/Pages/S.cs')); i++) await win.waitForTimeout(1000);
    check('and Update Namespace writes it', /namespace Shop\.Web\.Pages;/.test(read('Shop.Web/Pages/S.cs')), read('Shop.Web/Pages/S.cs'));
});

await session('a file onto a file', async ({ win, drag, dialog, has }) => {
    await drag('S.cs', 'Program.cs');
    check('it goes into that file\'s folder (Shop.Web)', has('Shop.Web/S.cs') && !has('Shop.Core/Single/S.cs'));
    await dialog().getByRole('button', { name: 'Skip' }).click().catch(() => {});
});

await session('Ctrl while dropping copies', async ({ win, drag, dialog, has }) => {
    await drag('S.cs', 'Pages', { ctrl: true });
    await win.waitForTimeout(3000);
    check('the file is in both places', has('Shop.Web/Pages/S.cs') && has('Shop.Core/Single/S.cs'));
    check('and nothing is asked', await dialog().count() === 0);
});

await session('a folder with several C# files', async ({ drag, dialogText, has }) => {
    await drag('Inventory', 'Pages');
    check('the folder moved', has('Shop.Web/Pages/Inventory/A.cs') && !has('Shop.Core/Inventory/A.cs'));
    const text = await dialogText();
    check('one question for the three files', /3 C# files have a namespace that does not match their new folder/.test(text), text);
});
