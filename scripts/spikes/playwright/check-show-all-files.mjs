// manual-testing.md, "Show All Files": the toolbar button toggles and shows its pressed state; with `<Compile Remove="Old/**" />` Old's files are
// hidden while it is off and greyed out while it is on (also bin and obj); a linked file shows under `Links`; the setting is remembered per
// solution after a reload (not covered here: the reload, another solution, the badge's position).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const csprojPath = join(import.meta.dirname, '../../screenshots/sample/src/Shop.Core/Shop.Core.csproj');
const csproj = readFileSync(csprojPath, 'utf8').replace('</Project>', '  <ItemGroup>\n    <Compile Remove="Old/**" />\n    <Compile Include="..\\Shared\\x.cs" Link="Links/x.cs" />\n  </ItemGroup>\n</Project>');
const ws = prepareWorkspace({}, {
    'src/Shop.Core/Shop.Core.csproj': csproj,
    'src/Shop.Core/Old/Hidden.cs': 'namespace Shop.Core.Old;\n\npublic class Hidden { }\n',
    'src/Shared/x.cs': 'namespace Shop.Shared;\n\npublic class X { }\n',
});
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const button = tree.getByRole('button', { name: 'Show All Files' });
    const row = n => tree.locator('.tree-node').filter({ has: tree.locator(`xpath=.//*[normalize-space(.)="${n}"]`) }).first();
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core']);
    await win.waitForTimeout(1000);
    check('the button starts unpressed', await button.getAttribute('aria-pressed') === 'false');
    check('Old is hidden', await row('Old').count() === 0);
    check('the linked file shows under Links', await row('Links').count() > 0);
    check('bin and obj are hidden', await row('bin').count() === 0 && await row('obj').count() === 0);

    await button.click();
    await win.waitForTimeout(1500);
    check('pressed after a click', await button.getAttribute('aria-pressed') === 'true');
    const classes = n => row(n).evaluate(e => e.className).catch(() => '');
    check('Old shows, greyed out', await row('Old').count() > 0 && /\bexcluded\b/.test(await classes('Old')), await classes('Old'));
    check('bin and obj show', await row('bin').count() > 0 && await row('obj').count() > 0);

    await button.click();
    await win.waitForTimeout(1500);
    check('off again: Old is hidden', await row('Old').count() === 0 && await button.getAttribute('aria-pressed') === 'false');
} finally { await app.close(); }
