// manual-testing.md: Configuration Manager and Configure Startup Projects tabs open, then Open Solution... switches to another solution: the tabs follow the new
// solution when changes happen (here: the grid and the project list show the other solution's projects, an edit of the other solution's file shows in the tab,
// and an edit of the first solution's file no longer does).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, findFrame, check } from './lib.mjs';

const other = `<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
  </Configurations>
  <Project Path="src/Shop.Core/Shop.Core.csproj" />
</Solution>
`;
const ws = prepareWorkspace({}, { 'Other.slnx': other });
const { app, win } = await launch(ws);
try {
    // Two solutions in the folder: the extension asks which one to open
    await win.waitForTimeout(8000);
    await win.keyboard.type('Contoso');
    await win.waitForTimeout(800);
    await win.keyboard.press('Enter');
    await openSolutionExplorer(win);
    const palette = async (text, pick) => {
        await win.keyboard.press('Control+Shift+p');
        await win.keyboard.type(text);
        await win.waitForTimeout(1200);
        await win.keyboard.press('Enter');
        if (pick) { await win.waitForTimeout(1500); await win.keyboard.type(pick); await win.waitForTimeout(800); await win.keyboard.press('Enter'); }
    };
    await palette('.NET: Configuration Manager');
    const cm = await findFrame(win, /Configuration Manager[\s\S]*Project contexts/, 40);
    check('Configuration Manager opens on Contoso (Shop.Web in the grid)', !!cm && /Shop\.Web/.test(await cm.locator('body').innerText()));
    await palette('.NET: Configure Startup Projects');
    const sp = await findFrame(win, /Startup/i, 40);
    check('Configure Startup Projects opens', !!sp);
    // Both tabs are in the window: find them by what only they show
    const startup = await findFrame(win, /Single startup project|Multiple startup projects/i, 30);
    check('and shows the startup choices', !!startup);

    // Open Other.slnx
    await palette('.NET: Open Solution...', 'Other');
    await win.waitForTimeout(6000);
    const root = (await (await openSolutionExplorer(win)).locator('.tree-node').allTextContents()).map(t => t.trim())[0];
    check('Open Solution switched the Solution Explorer to Other', root === 'Other', String(root));
    const grid = async () => (await cm.locator('body').innerText());
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { ok = !/Shop\.Web/.test(await grid()) && /Shop\.Core/.test(await grid()); if (!ok) await win.waitForTimeout(500); }
    check('after Open Solution the Configuration Manager grid lists only Other\'s project', ok, (await grid()).slice(0, 400));
    if (startup) {
        const text = async () => (await startup.locator('body').innerText());
        let ok2 = false;
        for (let i = 0; i < 20 && !ok2; i++) { ok2 = !/Shop\.Web/.test(await text()); if (!ok2) await win.waitForTimeout(500); }
        check('and the startup projects tab no longer lists Contoso\'s projects', ok2, (await text()).slice(0, 400));
    }

    // Changes: the new solution's file shows, the old one's does not (the list of configurations is the part that shows them)
    await win.getByRole('tab', { name: /Configuration Manager/ }).first().click();
    await cm.getByRole('button', { name: 'Edit Configurations...' }).click();
    await win.waitForTimeout(800);
    const names = async () => (await cm.locator('.names').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('the list shows Other\'s configurations (Debug, Release)', /Debug/.test(await names()) && /Release/.test(await names()), await names());
    writeFileSync(join(ws.folder, 'Contoso.slnx'), readFileSync(join(ws.folder, 'Contoso.slnx'), 'utf8').replace('<Solution>', '<Solution>\n  <Configurations>\n    <BuildType Name="Debug" />\n    <BuildType Name="Release" />\n    <BuildType Name="OldOne" />\n  </Configurations>'));
    await win.waitForTimeout(4000);
    check('an edit of Contoso.slnx does not reach the tab (OldOne is not listed)', !/OldOne/.test(await names()), await names());
    writeFileSync(join(ws.folder, 'Other.slnx'), other.replace('<BuildType Name="Release" />', '<BuildType Name="Release" />\n    <BuildType Name="NewOne" />'));
    await win.waitForTimeout(5000);
    check('an edit of Other.slnx shows in the tab (NewOne is listed)', /NewOne/.test(await names()), await names());
} finally { await app.close(); }
