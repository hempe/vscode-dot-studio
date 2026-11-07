// manual-testing.md, "Drag & drop opens the target" (the sample as .slnx and as .sln): a project, two projects and a solution folder with projects dropped onto a
// collapsed solution folder open it and select the moved nodes; a file dropped onto a collapsed folder opens it and is selected; collapsing the target right after
// the drop keeps it collapsed. And, in a `.slnx` without Ids: an open solution folder with open subfolders dragged into another solution folder stays open, subfolders too.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, sh, check } from './lib.mjs';

const centre = async locator => { await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

async function scenario(label, ws, body) {
    const { app, win } = await launch(ws);
    try {
        const tree = await openSolutionExplorer(win);
        const row = n => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).first();
        const isOpen = async n => (await row(n).count()) > 0 && await row(n).locator('.expand-icon').first().evaluate(e => !e.style.transform.includes('rotate(0deg)')).catch(() => false);
        const selected = async () => (await tree.locator('.tree-node.selected').allTextContents()).map(t => t.trim());
        const drag = async (from, to, { wait = 2500 } = {}) => {
            const a = await centre(row(from));
            await win.mouse.move(a.x, a.y, { steps: 3 });
            await win.mouse.down();
            const b = await centre(row(to));
            await win.mouse.move(b.x, b.y - 3, { steps: 12 });
            await win.mouse.move(b.x, b.y, { steps: 4 });
            await win.waitForTimeout(300);
            await win.mouse.up();
            await win.waitForTimeout(wait);
        };
        const collapse = async n => { if (await isOpen(n)) { await row(n).click(); await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(500); } };
        await body({ win, tree, row, isOpen, selected, drag, collapse, label });
    } finally { await app.close(); }
}

for (const kind of ['slnx', 'sln']) {
    const ws = prepareWorkspace({});
    if (kind === 'sln') {
        rmSync(join(ws.folder, 'Contoso.slnx'));
        await sh(ws, 'dotnet new sln -n Contoso --format sln');
        for (const [folder, projects] of [['src', ['Shop.Core', 'Shop.Generators', 'Shop.Web', 'Shop.Worker']], ['tests', ['Shop.Core.Tests']]]) {
            for (const p of projects) await sh(ws, `dotnet sln Contoso.sln add --solution-folder ${folder} ${folder}/${p}/${p}.csproj`);
        }
    }
    await scenario(kind, ws, async ({ win, tree, row, isOpen, selected, drag, collapse, label }) => {
        await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web']);
        await win.waitForTimeout(800);
        // A file onto a collapsed folder of a project
        await collapse('wwwroot');
        check(`[${label}] wwwroot is collapsed`, !(await isOpen('wwwroot')));
        await drag('appsettings.json', 'wwwroot');
        check(`[${label}] a file dropped onto the collapsed folder opens it`, await isOpen('wwwroot'));
        let fileSelected = false;
        for (let i = 0; i < 20 && !fileSelected; i++) { fileSelected = (await selected()).some(t => t.includes('appsettings.json')); if (!fileSelected) await win.waitForTimeout(250); }
        check(`[${label}] and the file is selected a moment later`, fileSelected, JSON.stringify(await selected()));

        // Collapsing the target right after the drop keeps it collapsed
        await collapse('Pages');
        await drag('appsettings.Development.json', 'Pages', { wait: 0 });
        for (let i = 0; i < 40 && !(await isOpen('Pages')); i++) await win.waitForTimeout(100);
        await row('Pages').click();
        await win.keyboard.press('ArrowLeft');
        await win.waitForTimeout(3500);
        check(`[${label}] collapsing the target right after the drop keeps it collapsed`, !(await isOpen('Pages')));
    });
    const ws2 = ws;
    await scenario(kind, ws2, async ({ win, tree, row, isOpen, selected, drag, collapse, label }) => {
        await expandPath(win, tree, ['Contoso', 'src']);
        await win.waitForTimeout(800);
        check(`[${label}] tests starts collapsed`, !(await isOpen('tests')));
        await drag('Shop.Worker', 'tests');
        check(`[${label}] a project dropped onto the collapsed folder opens it`, await isOpen('tests') && await row('Shop.Worker').count() > 0);
        check(`[${label}] and the moved project is selected`, JSON.stringify(await selected()) === JSON.stringify(['Shop.Worker']), JSON.stringify(await selected()));

        await collapse('tests');
        await win.waitForTimeout(2500);
        await row('Shop.Generators').click();
        await win.waitForTimeout(800);
        await win.keyboard.down('Control');
        await row('Shop.Web').click();
        await win.keyboard.up('Control');
        await win.waitForTimeout(800);
        await drag('Shop.Web', 'tests');
        const two = await selected();
        check(`[${label}] two projects dropped at once: the folder opens and both are selected`, await isOpen('tests') && two.includes('Shop.Generators') && two.includes('Shop.Web'), JSON.stringify(two));

        await collapse('tests');
        await drag('src', 'tests');
        const folder = await selected();
        check(`[${label}] a solution folder with projects dropped onto the collapsed folder: it opens and the folder is selected`, await isOpen('tests') && folder.length === 1 && folder[0] === 'src', JSON.stringify(folder));
    });
}

// An open solution folder with open subfolders, moved in a .slnx without Ids
const nested = `<Solution>
  <Folder Name="/A/">
    <Project Path="src/Shop.Core/Shop.Core.csproj" />
  </Folder>
  <Folder Name="/A/B/">
    <Project Path="src/Shop.Web/Shop.Web.csproj" />
  </Folder>
  <Folder Name="/A/B/C/">
    <File Path="README.md" />
  </Folder>
  <Folder Name="/Z/">
    <Project Path="src/Shop.Worker/Shop.Worker.csproj" />
  </Folder>
</Solution>
`;
const ws = prepareWorkspace({}, { 'Contoso.slnx': nested });
await scenario('slnx without Ids', ws, async ({ win, tree, row, isOpen, drag }) => {
    await expandPath(win, tree, ['Contoso', 'A', 'B', 'C']);
    await win.waitForTimeout(800);
    check('A, B and C are open', await isOpen('A') && await isOpen('B') && await isOpen('C'));
    await drag('A', 'Z');
    check('A moved into Z (Z is open)', await isOpen('Z'));
    check('A stays open', await isOpen('A'));
    check('B stays open, and C', await isOpen('B') && await isOpen('C'));
    check('and the README.md below C shows', await row('README.md').count() > 0);
});
