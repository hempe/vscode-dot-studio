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
    check('and to the file, which keeps every folder, project and file of the solution', /Staging/.test(slnx()) && (original.match(/(Path|Name)="[^"]+"/g) ?? []).every(a => slnx().includes(a)), slnx());
    await cm.getByLabel('Rename Staging').click();
    await cm.getByLabel('New name for Staging').fill('Qa');
    await cm.getByLabel('New name for Staging').press('Enter');
    await settle();
    // the projects keep their own configuration name (Project="Debug", copied from the active one), only the solution side changes, as in Visual Studio
    const renamed = await cm.getByLabel('Rename Qa').count() === 1 && /Solution="Qa\|/.test(slnx()) && !/Solution="Staging\|/.test(slnx());
    check('rename works (the solution side is Qa, the projects keep building in the configuration it was copied from)', renamed, `${await cm.locator('.names').innerText().catch(() => '')} | ${slnx().slice(-300)}`);
    await cm.getByLabel(renamed ? 'Remove Qa' : 'Remove Staging').click();
    await win.waitForTimeout(800);
    // a confirmation may follow
    for (const name of ['Remove', 'Delete', 'Yes']) { const b = win.getByRole('button', { name, exact: true }); if (await b.count()) { await b.first().click(); break; } }
    await settle();
    check('removing it takes it out of the list and the file', await cm.getByLabel(/Remove (Qa|Staging)/).count() === 0 && !/Solution="(Qa|Staging)\|/.test(slnx()), slnx().slice(-300));

    // Platforms: add (a dropdown appears), rename, remove
    await cm.getByRole('button', { name: 'Edit Platforms...' }).click();
    await cm.getByLabel('New platform name').fill('x64');
    await cm.getByRole('button', { name: 'Add', exact: true }).last().click();
    await settle();
    check('x64 is added to the list', await cm.getByLabel('Rename x64').count() === 1);
    check('and to the file', /Platform Name="x64"/.test(slnx()), slnx().slice(0, 600));
    check('and the platform dropdown appears', await cm.getByLabel('Active solution platform').count() > 0);
    await cm.getByLabel('Rename x64').click();
    await cm.getByLabel('New name for x64').fill('arm64');
    await cm.getByLabel('New name for x64').press('Enter');
    await settle();
    check('platform rename works', await cm.getByLabel('Rename arm64').count() === 1 && /Platform Name="arm64"/.test(slnx()) && !/Platform Name="x64"/.test(slnx()), slnx().slice(-300));
    await cm.getByLabel('Remove arm64').click();
    await win.waitForTimeout(800);
    for (const name of ['Remove', 'Delete', 'Yes']) { const b = win.getByRole('button', { name, exact: true }); if (await b.count()) { await b.first().click(); break; } }
    await settle();
    check('removing the platform takes it out of the list and the file', await cm.getByLabel('Rename arm64').count() === 0 && !/arm64/.test(slnx()), slnx().slice(-300));

    // The tab follows an edit of the file on disk
    writeFileSync(slnxPath, original.replace('<Solution>', '<Solution>\n  <Configurations>\n    <BuildType Name="Debug" />\n    <BuildType Name="Disk" />\n  </Configurations>'));
    await win.waitForTimeout(5000);
    check('the tab follows an edit of the solution file on disk', await cm.getByLabel('Rename Disk').count() === 1, (await cm.locator('.names').first().innerText().catch(() => '')).replace(/\s+/g, ' ') + ' | file has Disk: ' + /Disk/.test(slnx()));
} finally { await app.close(); }
