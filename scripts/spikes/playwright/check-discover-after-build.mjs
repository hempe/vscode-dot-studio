// manual-testing.md, "the new settings": `shinobi.tests.discoverAfterBuild`. On: after a build (Ctrl+Shift+B) the Testing view lists the
// tests of the test projects; off: they stay "not built yet" until the refresh button, which builds and discovers.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

for (const discover of [true, false]) {
    console.log(`discoverAfterBuild: ${discover}`);
    const ws = prepareWorkspace({ 'shinobi.tests.discoverAfterBuild': discover });
    const { app, win } = await launch(ws);
    try {
        await openSolutionExplorer(win);
        await win.locator('.activitybar [role=tab]:has(a[aria-label="Testing"])').click();
        const rows = () => win.locator('.pane-body .monaco-list-row').allInnerTexts();
        const notBuilt = async () => (await rows()).filter(t => t.includes('not built yet')).length;
        // The test projects are listed (not built yet) a moment after the view opens
        for (let i = 0; i < 40 && await notBuilt() < 3; i++) await win.waitForTimeout(500);
        check('three test projects are listed, none built yet', await notBuilt() === 3, JSON.stringify(await rows()));
        // Two refreshes run at the start (the Testing view opening, the solution loading); a second one still evaluating the projects when
        // the build ends finds them built and discovers them, rightly. The build starts after both: slow machines (CI) need longer
        await win.waitForTimeout(process.env.CI ? 30000 : 5000);

        await win.keyboard.press('Control+Shift+b');
        const dll = join(ws.folder, 'tests/Shop.Core.Tests/bin/Debug/net10.0/Shop.Core.Tests.dll');
        for (let i = 0; i < 90 && !existsSync(dll); i++) await win.waitForTimeout(2000);
        if (discover) {
            for (let i = 0; i < 60 && await notBuilt() > 0; i++) await win.waitForTimeout(1000);
            check('after the build the tests are discovered', await notBuilt() === 0, JSON.stringify(await rows()));
        } else {
            await win.waitForTimeout(15000);
            check('after the build nothing is discovered', await notBuilt() === 3, JSON.stringify(await rows()));
            await win.getByRole('button', { name: /Refresh Tests/i }).first().click();
            for (let i = 0; i < 90 && await notBuilt() > 0; i++) await win.waitForTimeout(1000);
            check('the refresh button builds and discovers', await notBuilt() === 0, JSON.stringify(await rows()));
        }
    } finally { await app.close(); }
}
