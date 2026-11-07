// manual-testing.md, NuGet manager: installed packages show their authors (also Serilog) and no "by Unknown"; the vulnerable and deprecated labels
// (Newtonsoft.Json 12.0.1, WindowsAzure.Storage 9.3.3) show a few seconds after the lists open, the details pane lists the advisory links and the
// alternative, the Vulnerable / Deprecated checkboxes narrow the list; the same in the Updates tab; Refresh keeps them; the Solution Explorer and the
// manager allow no `unsafe-eval` in their content security policy and both views work.
// Not covered: the labels in the solution manager of several projects and the transitive System.Net.Http / System.Text.RegularExpressions (net10.0 has
// them in the framework), and with the network off.
import { prepareWorkspace, launch, openSolutionExplorer, openNuGetManager, isolateHome, sh, check } from './lib.mjs';

const ws = prepareWorkspace({});
isolateHome(ws);
for (const [id, version] of [['Newtonsoft.Json', '12.0.1'], ['WindowsAzure.Storage', '9.3.3'], ['Serilog', '4.2.0']]) {
    await sh(ws, `dotnet add src/Shop.Core/Shop.Core.csproj package ${id} --version ${version}`);
}
await sh(ws, 'dotnet restore Contoso.slnx');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    check('the Solution Explorer has rows', await tree.locator('[data-vscode-context]').count() > 0);
    const csp = async frame => frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content', { timeout: 3000 }).catch(() => undefined);
    const treeCsp = await csp(tree);
    check('the Solution Explorer allows no unsafe-eval', !!treeCsp && !/unsafe-eval/.test(treeCsp), String(treeCsp));

    const manager = await openNuGetManager(win);
    check('the manager opens', !!manager);
    const managerCsp = await csp(manager);
    check('the manager allows no unsafe-eval', !!managerCsp && !/unsafe-eval/.test(managerCsp), String(managerCsp));
    await manager.getByRole('tab', { name: 'Installed' }).click();
    await manager.getByText(/Top-level packages \(\d+\)/).waitFor({ timeout: 60000 });

    const waitFor = async (re, seconds = 60) => { for (let i = 0; i < seconds; i++) { if (re.test(await manager.locator('body').innerText())) return true; await win.waitForTimeout(1000); } return false; };
    // Authors
    await waitFor(/Serilogby /);
    const item = id => manager.locator('div').filter({ hasText: new RegExp(`^${id.replace('.', '\\.')}by `) }).last();
    const text = await manager.locator('body').innerText();
    check('Serilog shows its authors', /Serilogby \S/.test(text), text.slice(0, 600));
    check('no "by Unknown"', !/by Unknown/.test(text));

    // Labels, a few seconds after the lists open
    check('Newtonsoft.Json is labelled "vulnerable: high"', await waitFor(/Newtonsoft\.Json[\s\S]{0,400}?vulnerable: high/i), (await manager.locator('body').innerText()).slice(0, 800));
    check('WindowsAzure.Storage is labelled "deprecated"', await waitFor(/WindowsAzure\.Storage[\s\S]{0,1500}?deprecated/i));

    // Details: the advisory links and the alternative
    await manager.getByText('Newtonsoft.Json', { exact: true }).first().click();
    await win.waitForTimeout(2000);
    const links = await manager.locator('a[href*="advisories"], a[href*="GHSA"]').count();
    check('the details of Newtonsoft.Json list the advisory links', links > 0, (await manager.locator('body').innerText()).slice(-800));
    await manager.getByText('WindowsAzure.Storage', { exact: true }).first().click();
    await win.waitForTimeout(2000);
    const details = await manager.locator('body').innerText();
    check('the details of WindowsAzure.Storage name the replacement', /(use|instead)[\s\S]{0,80}Azure\.Storage|Azure\.Storage\.Common/i.test(details) && /deprecated/i.test(details), details.slice(-800));

    // The filter checkboxes
    const countItems = async () => (await manager.getByText(/Top-level packages \((\d+)\)/).first().innerText()).match(/\d+/)[0];
    const all = await countItems();
    await manager.getByText('Vulnerable', { exact: true }).click();
    await win.waitForTimeout(1000);
    const vulnerable = await countItems();
    check('Vulnerable narrows the list', Number(vulnerable) < Number(all) && Number(vulnerable) >= 1, `${all} -> ${vulnerable}`);
    const firstItem = async () => (await manager.locator('body').innerText()).split(/Top-level packages \(\d+\)\s*/)[1]?.split('\n')[0] ?? '';
    check('only Newtonsoft.Json is left', Number(vulnerable) === 1 && /^Newtonsoft\.Json/.test(await firstItem()), await firstItem());
    await manager.getByText('Vulnerable', { exact: true }).click();
    await manager.getByText('Deprecated', { exact: true }).click();
    await win.waitForTimeout(1000);
    check('Deprecated narrows the list to the deprecated ones, WindowsAzure.Storage among them', Number(await countItems()) < Number(all) && /^WindowsAzure\.Storage/.test(await firstItem()), `${await countItems()} ${await firstItem()}`);
    await manager.getByText('Deprecated', { exact: true }).click();
    await win.waitForTimeout(500);

    // Updates and Refresh
    await manager.getByRole('tab', { name: 'Updates' }).click();
    check('Updates shows the labels too', await waitFor(/Newtonsoft\.Json[\s\S]{0,400}?vulnerable: high/i, 60));
    await manager.getByRole('tab', { name: 'Installed' }).click();
    await manager.locator('span[title="Refresh"] button').click();
    await win.waitForTimeout(3000);
    check('after Refresh the labels come back', await waitFor(/Newtonsoft\.Json[\s\S]{0,400}?vulnerable: high/i, 60));
} finally { await app.close(); }
