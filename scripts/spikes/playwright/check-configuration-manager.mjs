// WORK IN PROGRESS: the rename step fails (the inline rename input does not commit the new name; see the failing 'rename works' check); platforms, the file-change refresh and the .sln variant are not written yet.
// manual-testing.md, "Configuration Manager": opens from the palette; with only Any CPU there is no solution platform; the grid's Build checkbox decides
// what `dotnet build` of the solution builds; configurations and platforms can be added, renamed and removed (the last one cannot), the .slnx keeps its
// formatting; the tab follows an edit of the solution file on disk. The sample is a .slnx.
// Not covered: the same on a `.sln`, the solution's context menu and the title bar's menu (native), Select Solution Platform and F5/Pack mapping.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

const ws = prepareWorkspace({});
const slnxPath = join(ws.folder, 'Contoso.slnx');
const slnx = () => readFileSync(slnxPath, 'utf8');
const original = slnx();
const { app, win } = await launch(ws);
try {
    await openSolutionExplorer(win);
    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('.NET: Configuration Manager');
    await win.waitForTimeout(1200);
    await win.keyboard.press('Enter');
    let cm;
    for (let i = 0; i < 40 && !cm; i++) {
        for (const f of win.frames()) if (await f.getByRole('heading', { name: 'Configuration Manager' }).count().catch(() => 0)) cm = f;
        if (!cm) await win.waitForTimeout(500);
    }
    check('the tab opens from the command palette', !!cm);
    const settle = () => win.waitForTimeout(1500);
    check('with only Any CPU there is no solution platform dropdown', await cm.getByLabel('Active solution platform').count() === 0);

    // The grid's Build checkbox against `dotnet build` of the solution
    await cm.getByLabel('Shop.Web build').evaluate(e => e.click());
    await settle();
    check('the file says Shop.Web is not built', /Shop\.Web[\s\S]{0,200}Build[\s\S]{0,40}false/i.test(slnx()) || /Project="src\/Shop\.Web\/Shop\.Web\.csproj"[^>]*>[\s\S]*?<Build[^>]*Project="false"/i.test(slnx()), slnx().slice(-500));
    let output = '';
    try { output = execSync('dotnet build Contoso.slnx --configuration Debug -nologo', { cwd: ws.folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    check('dotnet build of the solution skips it', /Shop\.Core/.test(output) && !/Shop\.Web\s+(net10\.0\s+)?succeeded|Shop\.Web -> |Shop\.Web\.dll/.test(output), output.split('\n').filter(l => /Shop\.Web/.test(l)).join(' | '));
    await cm.getByLabel('Shop.Web build').evaluate(e => e.click());
    await settle();

    // Configurations: add, rename, remove
    await cm.getByRole('button', { name: 'Edit Configurations...' }).click();
    await cm.getByLabel('New configuration name').fill('Staging');
    await cm.getByRole('button', { name: 'Add', exact: true }).click();
    await settle();
    check('Staging is added to the list', await cm.getByLabel('Rename Staging').count() === 1);
    check('and to the file, whose other lines stay', /Staging/.test(slnx()) && original.split('\n').filter(l => l.trim()).every(l => slnx().includes(l)), slnx());
    await cm.getByLabel('Rename Staging').click();
    await cm.getByLabel('New name for Staging').fill('Qa');
    await cm.getByLabel('Rename Staging').click();
    await settle();
    const renamed = await cm.getByLabel('Rename Qa').count() === 1 && !/Staging/.test(slnx());
    check('rename works (Qa, no Staging in the file)', renamed, `${await cm.locator('.names').innerText().catch(() => '')} | ${slnx().slice(-300)}`);
    await cm.getByLabel(renamed ? 'Remove Qa' : 'Remove Staging').click();
    await win.waitForTimeout(800);
    // a confirmation may follow
    for (const name of ['Remove', 'Delete', 'Yes']) { const b = win.getByRole('button', { name, exact: true }); if (await b.count()) { await b.first().click(); break; } }
    await settle();
    check('removing it takes it out of the list and the file', await cm.getByLabel(/Remove (Qa|Staging)/).count() === 0 && !/Qa|Staging/.test(slnx()), slnx().slice(-300));
} finally { await app.close(); }
