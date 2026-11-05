// manual-testing.md, "the new settings": `shinobi.nuget.includePrerelease` on opens the NuGet manager with "Include prerelease" checked, off unchecked.
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

for (const on of [true, false]) {
    console.log(`includePrerelease: ${on}`);
    const ws = prepareWorkspace({ 'shinobi.nuget.includePrerelease': on });
    const { app, win } = await launch(ws);
    try {
        await openSolutionExplorer(win);
        await win.keyboard.press('Control+Shift+p');
        await win.keyboard.type('Open NuGet Package Manager for Solution');
        await win.waitForTimeout(1000);
        await win.keyboard.press('Enter');
        let box;
        for (let i = 0; i < 60 && !box; i++) {
            for (const f of win.frames()) {
                const c = f.getByText('Include prerelease').first().locator('xpath=..').locator('input[type=checkbox]').first();
                if (await c.count().catch(() => 0) > 0) { box = c; break; }
            }
            if (!box) await win.waitForTimeout(500);
        }
        if (!box) { await win.screenshot({ path: '/tmp/pw-nuget.png' }); check('the NuGet manager shows "Include prerelease"', false); continue; }
        check(`"Include prerelease" is ${on ? 'checked' : 'unchecked'}`, await box.isChecked() === on);
    } finally { await app.close(); }
}
