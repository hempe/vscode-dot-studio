// manual-testing.md, "Configuration Manager", on a `.sln` and a `.slnx`: Copy settings from, the last configuration cannot be removed, the grid's Configuration
// decides which configuration a project builds in under `dotnet build` of the solution, a renamed configuration leaves the projects building in their own Release,
// and the active solution configuration chosen in the tab is what Ctrl+Shift+B builds. check-configuration-manager.mjs covers the rest on the .slnx.
// Not covered: the platform column of the grid, Select Solution Platform in the title bar (native menu), F5 and Pack using the mapped configuration.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, sh, check } from './lib.mjs';

for (const kind of ['slnx', 'sln']) {
    const ws = prepareWorkspace({});
    const solution = `Contoso.${kind}`;
    if (kind === 'sln') {
        rmSync(join(ws.folder, 'Contoso.slnx'));
        await sh(ws, 'dotnet new sln -n Contoso --format sln');
        await sh(ws, 'dotnet sln Contoso.sln add src/Shop.Core/Shop.Core.csproj src/Shop.Web/Shop.Web.csproj');
    }
    const text = () => readFileSync(join(ws.folder, solution), 'utf8');
    const built = (project, configuration) => existsSync(join(ws.folder, 'src', project, 'bin', configuration));
    const clean = () => { for (const p of ['Shop.Core', 'Shop.Web']) for (const d of ['bin', 'obj']) rmSync(join(ws.folder, 'src', p, d), { recursive: true, force: true }); };
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
        check(`[${kind}] the tab opens`, !!cm);
        if (!cm) continue;
        const settle = () => win.waitForTimeout(1800);
        const pick = async (label, option) => { await cm.getByLabel(label, { exact: true }).click(); await cm.getByRole('option', { name: option, exact: true }).click(); await settle(); };

        // The grid's Configuration against dotnet build
        await pick('Shop.Core configuration', 'Release');
        clean();
        await sh(ws, `dotnet build ${solution} -c Debug -nologo`);
        check(`[${kind}] Shop.Core, set to Release in the grid, builds in Release under Debug`, built('Shop.Core', 'Release') && !built('Shop.Core', 'Debug') && built('Shop.Web', 'Debug'), `Core Release ${built('Shop.Core', 'Release')} Debug ${built('Shop.Core', 'Debug')}; Web Debug ${built('Shop.Web', 'Debug')}`);
        await pick('Shop.Core configuration', 'Debug');

        // Add Staging copying Release, rename it: the projects keep building in Release
        await cm.getByRole('button', { name: 'Edit Configurations...' }).click();
        await cm.getByLabel('New configuration name').fill('Staging');
        await cm.getByLabel('Copy settings from', { exact: true }).click();
        await cm.getByRole('option', { name: 'Release', exact: true }).click();
        await cm.getByRole('button', { name: 'Add', exact: true }).click();
        await settle();
        await cm.getByLabel('Rename Staging').click();
        await cm.getByLabel('New name for Staging').fill('Qa');
        await cm.getByLabel('New name for Staging').press('Enter');
        await settle();
        check(`[${kind}] the renamed configuration is Qa`, await cm.getByLabel('Rename Qa').count() === 1, text().slice(-500));
        clean();
        const qaBuild = await sh(ws, `dotnet build ${solution} -c Qa -nologo`);
        check(`[${kind}] dotnet build -c Qa builds the projects in their own Release (copied from Release)`, built('Shop.Core', 'Release') && built('Shop.Web', 'Release') && !built('Shop.Core', 'Qa'), `Core Release ${built('Shop.Core', 'Release')} Qa ${built('Shop.Core', 'Qa')}; Web Release ${built('Shop.Web', 'Release')}\n${qaBuild.slice(-700)}\n${text().slice(0, 1500)}`);

        // The active configuration chosen in the tab is what Ctrl+Shift+B builds
        await pick('Active solution configuration', 'Release');
        clean();
        await win.keyboard.press('Control+Shift+b');
        for (let i = 0; i < 90 && !built('Shop.Web', 'Release'); i++) await win.waitForTimeout(2000);
        check(`[${kind}] Ctrl+Shift+B builds the active configuration (Release)`, built('Shop.Web', 'Release') && !built('Shop.Web', 'Debug'), `Web Release ${built('Shop.Web', 'Release')} Debug ${built('Shop.Web', 'Debug')}`);
        await pick('Active solution configuration', 'Debug');

        // Remove until one is left: the last cannot be removed
        for (const name of ['Qa', 'Release']) { await cm.getByLabel(`Remove ${name}`).click(); await win.waitForTimeout(800); for (const label of ['Remove', 'Delete', 'Yes']) { const b = win.getByRole('button', { name: label, exact: true }); if (await b.count()) { await b.first().click(); break; } } await settle(); }
        check(`[${kind}] with Debug the only one, its Remove button is disabled`, await cm.getByLabel('Remove Debug').isDisabled(), String(await cm.locator('.names').first().innerText().catch(() => '')));
        check(`[${kind}] the file lists no Release or Qa configuration any more`, !/\|(Release|Qa)\b|"(Release|Qa)"/.test(text()), text().slice(-600));
    } finally { await app.close(); }
}
