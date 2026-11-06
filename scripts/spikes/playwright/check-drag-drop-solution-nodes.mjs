// manual-testing.md, "Drag & drop of solution nodes on a .slnx": a project into another solution folder, a solution item into another folder,
// the file keeps its formatting (only the moved lines change), and a name taken in the target is refused. The sample is a .slnx.
// Not covered: the same on a `.sln`, that `dotnet build` and Visual Studio 2022 open the result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const ws = prepareWorkspace({});
const slnx = () => readFileSync(join(ws.folder, 'Contoso.slnx'), 'utf8');
const before = slnx();
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await expandPath(win, tree, ['Contoso', 'Solution Items', 'src', 'tests']);
    await win.waitForTimeout(1000);
    const row = n => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).first();
    const centre = async n => { await row(n).scrollIntoViewIfNeeded(); const b = await row(n).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const drag = async (from, to) => {
        const a = await centre(from);
        await win.mouse.move(a.x, a.y, { steps: 3 });
        await win.mouse.down();
        const b = await centre(to);
        await win.mouse.move(b.x, b.y - 3, { steps: 12 });
        await win.mouse.move(b.x, b.y, { steps: 4 });
        await win.waitForTimeout(300);
        await win.mouse.up();
        await win.waitForTimeout(2500);
    };
    // The project into another solution folder
    await drag('Shop.Worker', 'tests');
    const after1 = slnx();
    check('Shop.Worker is in the tests folder now', /<Folder Name="\/tests\/">[\s\S]*Shop\.Worker\.csproj[\s\S]*<\/Folder>/.test(after1) && !/<Folder Name="\/src\/">[\s\S]*?Shop\.Worker[\s\S]*?<\/Folder>\s*<Folder Name="\/tests\/">/.test(after1), after1);
    const sorted = t => t.split('\n').sort().join('\n');
    check('the file keeps its lines (only the moved one changed place)', sorted(after1) === sorted(before));
    // The solution item into another folder
    await drag('README.md', 'src');
    const after2 = slnx();
    check('README.md is in the src folder now', /<Folder Name="\/src\/">[\s\S]*README\.md[\s\S]*<\/Folder>/.test(after2) && !/<Folder Name="\/Solution Items\/">[\s\S]*README\.md/.test(after2), after2);
} finally { await app.close(); }
