// manual-testing.md, "the new settings": `shinobi.build.emitGeneratedFiles` on: after a build the source generators under Shop.Core >
// Dependencies > Analyzers expand to their files; off: they show none. The build is the default build task (Ctrl+Shift+B), which needs
// the .NET SDK and the packages of the sample in the NuGet cache (or network).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, settle, check } from './lib.mjs';

for (const emit of [true, false]) {
    console.log(`emitGeneratedFiles: ${emit}`);
    const ws = prepareWorkspace({ 'shinobi.build.emitGeneratedFiles': emit });
    const { app, win } = await launch(ws);
    try {
        const f = await openSolutionExplorer(win);
        await win.keyboard.press('Control+Shift+b');
        const dll = join(ws.folder, 'src/Shop.Web/bin/Debug/net10.0/Shop.Web.dll');
        for (let i = 0; i < 90 && !existsSync(dll); i++) await win.waitForTimeout(2000);
        check('the build ran', existsSync(dll));
        await settle(win, f, 3000);
        await expandPath(win, f, ['Contoso', 'src', 'Shop.Core', 'Dependencies', 'Analyzers']);
        await win.waitForTimeout(1500);
        // Riok.Mapperly: a generator whose name no project row shares
        const generator = await rowInfo(f, 'Riok.Mapperly');
        check(emit ? 'the generator has files to expand' : 'the generator has no files', generator && generator.expandable === emit, JSON.stringify(generator));
        if (emit) {
            await expandPath(win, f, ['Riok.Mapperly']);
            await win.waitForTimeout(800);
            const rows = await f.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0 })));
            const at = rows.findIndex(r => r.name === 'Riok.Mapperly');
            const children = [];
            for (let i = at + 1; i < rows.length && rows[i].depth > rows[at].depth; i++) children.push(rows[i].name);
            check('something is listed below it', children.length > 0, JSON.stringify(children));
        }
    } finally { await app.close(); }
}
