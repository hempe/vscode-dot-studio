// manual-testing.md, "the new settings": `fileNesting` off / default / web (a `site.min.js` next to `site.js`).
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, check } from './lib.mjs';

for (const mode of ['default', 'off', 'web']) {
    console.log(`fileNesting: ${mode}`);
    const ws = prepareWorkspace({ 'shinobi.solutionExplorer.fileNesting': mode }, { 'src/Shop.Web/wwwroot/js/site.min.js': '// minified\n' });
    const { app, win } = await launch(ws);
    try {
        const f = await openSolutionExplorer(win);
        await expandPath(win, f, ['Contoso', 'src', 'Shop.Web', 'Pages', 'wwwroot', 'js']);
        const index = await rowInfo(f, 'Index.cshtml');
        const code = await rowInfo(f, 'Index.cshtml.cs');
        const site = await rowInfo(f, 'site.js');
        const min = await rowInfo(f, 'site.min.js');
        if (mode === 'off') {
            check('Index.cshtml.cs sits next to Index.cshtml', code && code.depth === index.depth, JSON.stringify({ index, code }));
            check('Index.cshtml has nothing nested', index && !index.expandable);
        } else {
            check('Index.cshtml.cs is hidden under Index.cshtml', index?.expandable && code === null, JSON.stringify({ index, code }));
            await expandPath(win, f, ['Index.cshtml']);
            const nested = await rowInfo(f, 'Index.cshtml.cs');
            check('expanded, Index.cshtml.cs is one level deeper', nested && nested.depth > index.depth, JSON.stringify({ index, nested }));
        }
        if (mode === 'web') {
            check('site.min.js is nested under site.js', site?.expandable && min === null, JSON.stringify({ site, min }));
        } else {
            check('site.min.js sits next to site.js', site && min && min.depth === site.depth && !site.expandable, JSON.stringify({ site, min }));
        }
    } finally { await app.close(); }
}
