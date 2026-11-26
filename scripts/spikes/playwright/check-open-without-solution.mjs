// docs/solution-explorer.md, "Without a solution": a folder with projects and no solution shows Visual Studio's temporary solution
// ("Contoso (not saved)" with the projects); the default build task builds it; Add Solution Folder asks to save first: Cancel leaves
// the folder without a solution file, Save writes Contoso.slnx next to the projects with the folder in it, and the tree loses "(not saved)".
// Not covered: a file opened without a folder (the window reloads; unit tests and manual-testing.md).
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, contextMenu, answerInput, answerFileDialog, modal, settle, check } from './lib.mjs';

const ws = prepareWorkspace({});
rmSync(join(ws.folder, 'Contoso.slnx'));
const solutionFiles = () => readdirSync(ws.folder).filter(f => /\.slnx?$/.test(f));
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await settle(win, tree);
    const rows = async () => (await tree.locator('.tree-node').allInnerTexts()).map(t => t.trim());
    await expandPath(win, tree, ['Contoso (not saved)']);
    await settle(win, tree);
    const rowsNow = await rows();
    check('the folder opens as a temporary solution, "Contoso (not saved)"', rowsNow.includes('Contoso (not saved)'), JSON.stringify(rowsNow.slice(0, 3)));
    check('with its projects at the root (no solution folders)', ['Shop.Core', 'Shop.Web', 'Shop.Worker'].every(name => rowsNow.includes(name)), JSON.stringify(rowsNow));

    await win.keyboard.press('Control+Shift+b');
    const dll = join(ws.folder, 'src/Shop.Core/bin/Debug/net10.0/Shop.Core.dll');
    for (let i = 0; i < 90 && !existsSync(dll); i++) await win.waitForTimeout(2000);
    check('the default build task builds the temporary solution', existsSync(dll));
    check('and writes no solution file into the folder', solutionFiles().length === 0, JSON.stringify(solutionFiles()));

    await contextMenu(win, tree, 'Contoso (not saved)', ['Add Solution Folder']);
    await answerInput(win, 'Libs');
    const ask = await modal(win);
    check('Add Solution Folder asks to save the solution first', !!ask && /not saved yet/.test(ask.text), ask?.text);
    if (ask) await ask.press('Cancel');
    await win.waitForTimeout(1000);
    check('Cancel writes no solution file', solutionFiles().length === 0, JSON.stringify(solutionFiles()));
    check('and the solution stays "(not saved)"', (await rows()).includes('Contoso (not saved)'));

    await contextMenu(win, tree, 'Contoso (not saved)', ['Add Solution Folder']);
    await answerInput(win, 'Libs');
    await (await modal(win))?.press('Save...');
    await answerFileDialog(win, join(ws.folder, 'Contoso.slnx'));
    const saved = join(ws.folder, 'Contoso.slnx');
    for (let i = 0; i < 60 && !(existsSync(saved) && /Libs/.test(readFileSync(saved, 'utf8'))); i++) await win.waitForTimeout(500);
    const xml = existsSync(saved) ? readFileSync(saved, 'utf8') : '';
    check('Save writes Contoso.slnx next to the projects, with the projects', /src\/Shop\.Core\/Shop\.Core\.csproj/.test(xml) && /Shop\.Web\.csproj/.test(xml), xml);
    check('and the new solution folder in it', /<Folder Name="\/Libs\/"/.test(xml), xml);
    await settle(win, tree);
    await expandPath(win, tree, ['Contoso']);
    await settle(win, tree);
    check('the tree shows the saved solution', (await rows()).includes('Contoso') && !(await rows()).some(r => /not saved/.test(r)), JSON.stringify((await rows()).slice(0, 3)));
    check('with the Libs folder', (await rows()).includes('Libs'), JSON.stringify(await rows()));
} finally {
    await app.close();
}
