// manual-testing.md, "Dependencies > Frameworks" and "Project onto Dependencies": the framework references of the sample projects, and a project dragged onto
// another's Dependencies adds a ProjectReference (twice: "already referenced"; a cycle: refused). Not covered: the pointer shape, a net10.0 project
// onto a net8.0 one, a FrameworkReference written while the view is open.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const ws = prepareWorkspace({});
const csproj = p => readFileSync(join(ws.folder, 'src', p), 'utf8');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const row = (n, i = 0) => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).nth(i);
    const names = () => tree.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0 })));
    const below = async (name, nth = 0) => {
        const rows = await names();
        const idx = rows.map((r, i) => r.name === name ? i : -1).filter(i => i >= 0)[nth];
        const out = [];
        for (let i = idx + 1; i < rows.length && rows[i].depth > rows[idx].depth; i++) out.push(rows[i].name);
        return out;
    };
    const toast = async () => { const t = win.locator('.notification-toast').first(); await t.waitFor({ timeout: 8000 }).catch(() => {}); return (await t.innerText().catch(() => '')).replace(/\s+/g, ' '); };

    // Frameworks
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core', 'Dependencies', 'Frameworks']);
    await win.waitForTimeout(800);
    const coreFrameworks = await below('Frameworks');
    check('Shop.Core shows Microsoft.NETCore.App only', coreFrameworks.length === 1 && coreFrameworks[0].startsWith('Microsoft.NETCore.App'), JSON.stringify(coreFrameworks));
    check('and it is not in the .csproj', !/Microsoft\.NETCore\.App/.test(csproj('Shop.Core/Shop.Core.csproj')));
    await expandPath(win, tree, ['Shop.Web']);
    await win.waitForTimeout(500);
    // Shop.Web's Dependencies is the one below Shop.Web
    await win.waitForTimeout(500);
    const webRows = await below('Shop.Web');
    check('Shop.Web has its Dependencies', webRows.includes('Dependencies'), JSON.stringify(webRows));

    // Shop.Web's Dependencies > Frameworks (the second ones in the tree)
    const open = async (locator) => { await locator.click(); await win.keyboard.press('ArrowRight'); await win.waitForTimeout(800); };
    await open(row('Dependencies', 1));
    await open(row('Frameworks', 1));
    const webFrameworks = await below('Frameworks', 1);
    check('Shop.Web shows Microsoft.NETCore.App and Microsoft.AspNetCore.App', webFrameworks.some(n => n.startsWith('Microsoft.NETCore.App')) && webFrameworks.some(n => n.startsWith('Microsoft.AspNetCore.App')), JSON.stringify(webFrameworks));

    // Project onto Dependencies: Shop.Generators onto Shop.Web's Dependencies (the second Dependencies row in the tree)
    const centre = async (locator) => { await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
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
    const webDependencies = () => row('Dependencies', 1);
    await drag(row('Shop.Generators'), webDependencies());
    check('the drop adds a ProjectReference to Shop.Web.csproj', /ProjectReference Include="\.\.\\Shop\.Generators\\Shop\.Generators\.csproj"|ProjectReference Include="\.\.\/Shop\.Generators\/Shop\.Generators\.csproj"/.test(csproj('Shop.Web/Shop.Web.csproj')), csproj('Shop.Web/Shop.Web.csproj'));
    await win.locator('.notification-toast .codicon-close').first().click().catch(() => {});
    await drag(row('Shop.Generators'), webDependencies());
    const again = await toast();
    check('dropping it again says it is already referenced', /already/i.test(again), again);
    await win.locator('.notification-toast .codicon-close').first().click().catch(() => {});
    // The cycle: Shop.Web onto Shop.Core's Dependencies
    const before = csproj('Shop.Core/Shop.Core.csproj');
    await drag(row('Shop.Web'), row('Dependencies', 0));
    const cycle = await toast();
    check('Shop.Web onto Shop.Core\'s Dependencies would be circular', /circular/i.test(cycle) && csproj('Shop.Core/Shop.Core.csproj') === before, cycle);
} finally { await app.close(); }
