// manual-testing.md, "Dependencies on every project": a fresh `dotnet new console` project added to the solution shows Dependencies with Analyzers, Packages,
// Projects, Assemblies (and Frameworks). Not covered: that its (native) menu has Add Service Reference... offering WCF and gRPC.
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, sh, check } from './lib.mjs';

const ws = prepareWorkspace({});
await sh(ws, 'dotnet new console -n Fresh -o src/Fresh --no-restore');
await sh(ws, 'dotnet sln Contoso.slnx add src/Fresh/Fresh.csproj --solution-folder src');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await expandPath(win, tree, ['Contoso', 'src', 'Fresh', 'Dependencies']);
    await win.waitForTimeout(1500);
    const rows = await tree.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0 })));
    const at = rows.findIndex((r, i) => r.name === 'Dependencies' && rows.slice(0, i).some(x => x.name === 'Fresh'));
    const below = [];
    for (let i = at + 1; at >= 0 && i < rows.length && rows[i].depth > rows[at].depth; i++) below.push(rows[i].name);
    check('Fresh has a Dependencies node', at >= 0, JSON.stringify(rows.map(r => r.name)));
    for (const name of ['Analyzers', 'Packages', 'Projects', 'Assemblies', 'Frameworks']) {
        check(`Dependencies has ${name}`, below.some(n => n === name), JSON.stringify(below));
    }
} finally { await app.close(); }
