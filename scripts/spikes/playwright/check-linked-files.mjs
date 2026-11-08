// manual-testing.md, "Linked files, Delete and Remove Link" (Shop.Core links ..\Shared\Shared.cs as Linked\Shared.cs; Shop.Worker links it too for the last part):
// the menu has Remove Link and no Exclude From Project; Remove Link takes the line out of the project file, the file stays and the node leaves the tree; with the link
// back, Delete asks "Delete the linked file 'Shared.cs'?" with the real path and the buttons Remove Link and Delete; Remove Link there does the same as the menu;
// Delete moves Shared/Shared.cs to the trash; the linked file and a file of the project selected and the Delete key: the question names the linked file; a file
// linked by two projects asks which project Remove Link is for.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, rowsNamed, contextMenu, contextMenuOn, menuLabels, modal, quickItems, isolateHome, part, settle, check } from './lib.mjs';

const sample = join(import.meta.dirname, '../../screenshots/sample');
const link = '    <Compile Include="..\\Shared\\Shared.cs" Link="Linked\\Shared.cs" />\n';
const withLink = text => text.replace('</Project>', `  <ItemGroup>\n${link}  </ItemGroup>\n\n</Project>`);
const core = withLink(readFileSync(join(sample, 'src/Shop.Core/Shop.Core.csproj'), 'utf8'));
const ws = prepareWorkspace({}, { 'src/Shop.Core/Shop.Core.csproj': core, 'src/Shared/Shared.cs': 'namespace Shop.Shared;\n\npublic class Shared { }\n' });
isolateHome(ws);
const coreProj = join(ws.folder, 'src/Shop.Core/Shop.Core.csproj');
const shared = join(ws.folder, 'src/Shared/Shared.cs');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const until = async (fn, seconds = 20) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    const relink = async () => { writeFileSync(coreProj, core); return until(async () => !!await rowInfo(tree, 'Shared.cs'), 40); };
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core', 'Linked']);
    await settle(win, tree);

    await part('menu and Remove Link', async () => {
        const menu = await menuLabels(win, tree, 'Shared.cs');
        check('the linked file\'s menu has Remove Link and no Exclude From Project', menu.includes('Remove Link') && !menu.includes('Exclude From Project'), JSON.stringify(menu));
        await contextMenu(win, tree, 'Shared.cs', ['Remove Link']);
        check('Remove Link takes the line out of the project file (the rest as it was)', await until(() => readFileSync(coreProj, 'utf8') === core.replace(link, '').replace('  <ItemGroup>\n  </ItemGroup>\n\n', '') || !readFileSync(coreProj, 'utf8').includes('Shared.cs')), readFileSync(coreProj, 'utf8'));
        check('the file stays in Shared/', existsSync(shared));
        check('and the node leaves the tree', await until(async () => !await rowInfo(tree, 'Shared.cs')));
    });

    await part('Delete on a linked file', async () => {
        check('with the link back the node shows again', await relink());
        await expandPath(win, tree, ['Linked']);
        await contextMenu(win, tree, 'Shared.cs', ['Delete']);
        const ask = await modal(win);
        check('Delete asks "Delete the linked file \'Shared.cs\'?" with the real path', !!ask && /Delete the linked file 'Shared\.cs'\?/.test(ask.text) && ask.text.includes(join('src', 'Shared', 'Shared.cs')), ask?.text);
        const buttons = (await win.locator('.monaco-dialog-box .monaco-button').allInnerTexts()).map(b => b.trim());
        check('with the buttons Remove Link and Delete', buttons.includes('Remove Link') && buttons.includes('Delete'), JSON.stringify(buttons));
        if (ask) await ask.press('Remove Link');
        check('Remove Link there does the same as the menu: the file stays, the link goes', await until(() => !readFileSync(coreProj, 'utf8').includes('Shared.cs')) && existsSync(shared));

        check('link back', await relink());
        await expandPath(win, tree, ['Linked']);
        await (await rowsNamed(tree, 'Shared.cs'))[0].locator.click();
        await win.waitForTimeout(600);
        await win.keyboard.press('Delete');
        const viaKey = await modal(win);
        check('the Delete key asks the same question', !!viaKey && /Delete the linked file 'Shared\.cs'\?/.test(viaKey.text), viaKey?.text);
        if (viaKey) await viaKey.press('Delete');
        check('Delete moves Shared/Shared.cs to the trash (gone from its folder)', await until(() => !existsSync(shared), 20));
    });

    await part('several selected', async () => {
        writeFileSync(shared, 'namespace Shop.Shared;\n\npublic class Shared { }\n');
        check('link back (file restored)', await relink());
        await expandPath(win, tree, ['Linked', 'Pricing']);
        await settle(win, tree);
        await (await rowsNamed(tree, 'Shared.cs'))[0].locator.click();
        await win.waitForTimeout(600);
        const other = (await tree.locator('.tree-node').filter({ has: tree.locator('xpath=.//*[normalize-space(.)="PriceCalculator.cs"]') }).first());
        await win.keyboard.down('Control');
        await other.click();
        await win.keyboard.up('Control');
        await win.waitForTimeout(800);
        await win.keyboard.press('Delete');
        const ask = await modal(win);
        check('the linked file and a file of the project selected, Delete: the question names the linked file', !!ask && /Shared\.cs/.test(ask.text), ask?.text);
        if (ask) await win.keyboard.press('Escape');
        await win.waitForTimeout(800);
        check('Escape changes nothing', existsSync(shared) && existsSync(join(ws.folder, 'src/Shop.Core/Pricing/PriceCalculator.cs')));
    });

    await part('two projects', async () => {
        const worker = join(ws.folder, 'src/Shop.Worker/Shop.Worker.csproj');
        writeFileSync(worker, withLink(readFileSync(worker, 'utf8')));
        await expandPath(win, tree, ['Shop.Worker']);
        await settle(win, tree, 3000, 40000);
        await contextMenuOn(win, (await rowsNamed(tree, 'Shared.cs'))[0].locator, ['Delete']);
        const ask = await modal(win);
        if (ask) await ask.press('Remove Link');
        const items = await quickItems(win);
        check('a file linked by two projects: Remove Link asks which project', items.some(i => /Shop\.Core/.test(i)) && items.some(i => /Shop\.Worker/.test(i)), JSON.stringify(items));
        if (items.length) await win.keyboard.press('Escape');
    });
} finally { await app.close(); }
