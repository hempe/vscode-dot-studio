// manual-testing.md, NuGet manager: the Sources tab (setting shinobi.nuget.packageSources) lists the feeds with their files, the checkbox disables and enables a source
// (`dotnet nuget list source` agrees, Browse's dropdown follows), Add writes the user's config or the solution's nuget.config, a duplicate name and a bad address show the
// problem, Remove asks first and edits the file that defined it; with the setting off there is no tab. The Package source dropdown of Browse searches one feed; on Updates it
// filters the list to one feed's packages; Refresh shows a package published meanwhile. The private feed is a folder with packed .nupkg files; HOME is a throwaway one.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, openNuGetManager, isolateHome, sh, startFeed, check } from './lib.mjs';

const ws = prepareWorkspace({ 'shinobi.nuget.packageSources': true });
const home = isolateHome(ws);
const userConfig = join(home, '.nuget/NuGet/NuGet.Config');
const solutionConfig = join(ws.folder, 'nuget.config');
const feed = join(ws.work, 'feed');
const lib = join(ws.work, 'privlib');
const localFeed = join(ws.work, 'local-feed');
mkdirSync(localFeed, { recursive: true });
const other = join(ws.work, 'other-feed');
mkdirSync(other, { recursive: true });
mkdirSync(feed, { recursive: true }); mkdirSync(lib, { recursive: true });
writeFileSync(join(lib, 'PrivLib.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><Authors>Me</Authors></PropertyGroup></Project>');
writeFileSync(join(lib, 'C.cs'), 'public class C {}');
const pack = version => sh({ folder: lib }, `dotnet pack -c Release -p:Version=${version} -o "${feed}"`);
await pack('1.0.0'); await pack('2.0.0');
const server = await startFeed(feed);
// The private feed over HTTP, declared before the manager opens (restore needs allowInsecureConnections for http)
writeFileSync(solutionConfig, `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <add key="Priv" value="${server.url}" allowInsecureConnections="true" />\n  </packageSources>\n</configuration>\n`);
await sh(ws, 'dotnet nuget list source'); // creates the user's config in the throwaway HOME
check('the user config exists', existsSync(userConfig));
const sources = () => sh(ws, 'dotnet nuget list source');

const { app, win } = await launch(ws);
try {
    await openSolutionExplorer(win);
    const manager = await openNuGetManager(win);
    const tab = name => manager.getByRole('tab', { name, exact: true });
    const wait = async (fn, seconds = 30) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    const body = () => manager.locator('body').innerText();
    const options = async label => { await manager.getByLabel(label, { exact: true }).click(); const l = await manager.locator('[role=option]').allTextContents(); await win.keyboard.press('Escape'); return l.map(x => x.trim()); };
    await tab('Sources').click();
    check('the Sources tab lists nuget.org with its file', await wait(async () => /nuget\.org[\s\S]*NuGet\/NuGet\.Config/.test(await body())), (await body()).slice(0, 500));
    const row = name => manager.locator('tr').filter({ hasText: name });

    // Disable and enable
    await row('nuget.org').getByRole('checkbox').evaluate(e => e.click());
    check('disabling nuget.org shows in dotnet nuget list source', await wait(async () => /\[Disabled\]/.test(await sources())), await sources());
    await tab('Browse').click();
    await win.waitForTimeout(1500);
    check('Browse\'s dropdown loses it', !(await options('Package source')).includes('nuget.org'));
    await tab('Sources').click();
    await row('nuget.org').getByRole('checkbox').evaluate(e => e.click());
    check('enabling it again shows too', await wait(async () => !/\[Disabled\]/.test(await sources())), await sources());

    // Add: the user's config, the solution's nuget.config
    const add = async (name, url, where) => {
        await manager.getByPlaceholder('Name', { exact: true }).fill(name);
        await manager.getByPlaceholder(/index\.json or a folder/).fill(url);
        await manager.getByLabel('Where to save the source').click();
        await manager.getByRole('option', { name: where }).click();
        await manager.getByRole('button', { name: 'Add', exact: true }).click();
        await win.waitForTimeout(2500);
    };
    await add('Feed', localFeed, "The solution's nuget.config");
    check('Add with the solution\'s nuget.config writes that file, next to Priv', /Feed/.test(readFileSync(solutionConfig, 'utf8')) && /Priv/.test(readFileSync(solutionConfig, 'utf8')), readFileSync(solutionConfig, 'utf8'));
    check('and the row says where it is defined', /Feed[\s\S]*nuget\.config/.test(await body()), (await body()).slice(0, 500));
    await add('Mine', other, 'Your NuGet.Config');
    check('Add with the user config writes the user\'s file', /Mine/.test(readFileSync(userConfig, 'utf8')), readFileSync(userConfig, 'utf8'));
    await add('Mine', other, 'Your NuGet.Config');
    check('a duplicate name shows the problem', await wait(async () => await manager.getByRole('alert').count() > 0, 8), (await body()).slice(0, 400));
    await add('Bad', 'not a source', 'Your NuGet.Config');
    check('a bad address shows the problem and is not written', await manager.getByRole('alert').count() > 0 && !/Bad/.test(readFileSync(userConfig, 'utf8')), (await body()).slice(0, 400));

    // Remove asks first and edits the file that defined the source
    await row('Mine').getByRole('button', { name: 'Remove' }).click();
    await win.waitForTimeout(1200);
    const confirm = win.getByRole('button', { name: /^Remove$/ }).last();
    check('Remove asks first', /Mine/.test(readFileSync(userConfig, 'utf8')) && await win.locator('.monaco-dialog-box').count() > 0);
    await confirm.click();
    check('and then edits the user\'s file', await wait(() => !/Mine/.test(readFileSync(userConfig, 'utf8')), 10), readFileSync(userConfig, 'utf8'));
    check('the solution\'s nuget.config keeps Feed', /Feed/.test(readFileSync(solutionConfig, 'utf8')));

    // The Package source dropdown on Browse
    await tab('Browse').click();
    await win.waitForTimeout(1500);
    check('Browse lists All and the enabled sources', JSON.stringify((await options('Package source')).sort()) === JSON.stringify(['All', 'Feed', 'Priv', 'nuget.org'].sort()), JSON.stringify(await options('Package source')));
    await manager.getByPlaceholder('Search for packages...').fill('PrivLib');
    await manager.getByLabel('Package source', { exact: true }).click();
    await manager.getByRole('option', { name: 'Priv', exact: true }).click();
    check('searching one feed finds the package only it has', await wait(async () => /PrivLib/.test(await body()), 30), (await body()).slice(0, 400));
    await manager.getByLabel('Package source', { exact: true }).click();
    await manager.getByRole('option', { name: 'nuget.org', exact: true }).click();
    await win.waitForTimeout(4000);
    check('nuget.org does not have it', await wait(async () => !/PrivLib from the private feed/.test(await body()), 20), (await body()).slice(0, 300));
    await manager.getByLabel('Package source', { exact: true }).click();
    await manager.getByRole('option', { name: 'All', exact: true }).click();
    check('All searches every source', await wait(async () => /PrivLib/.test(await body()), 30));

    // Updates: filtered by feed; Refresh shows a new version
    await sh(ws, 'dotnet add src/Shop.Core/Shop.Core.csproj package PrivLib --version 1.0.0');
    check('PrivLib 1.0.0 is installed from the private feed', /PrivLib/.test(readFileSync(join(ws.folder, 'src/Shop.Core/Shop.Core.csproj'), 'utf8')));
    await tab('Updates').click();
    await manager.locator('span[title="Refresh"] button').click();
    check('Updates offers PrivLib 2.0.0', await wait(async () => /PrivLib[\s\S]{0,80}2\.0\.0/.test(await body()), 40), (await body()).slice(0, 500));
    await manager.getByLabel('Package source filter').click();
    await manager.getByRole('option', { name: 'nuget.org', exact: true }).click();
    await win.waitForTimeout(1000);
    const updatesCount = async () => Number(/Updates \((\d+)\)/.exec(await body())?.[1] ?? -1);
    check('filtered to nuget.org the list loses PrivLib (10 of 11 left)', await updatesCount() === 10, String(await updatesCount()));
    await manager.getByLabel('Package source filter').click();
    await manager.getByRole('option', { name: 'Priv', exact: true }).click();
    await win.waitForTimeout(1000);
    check('filtered to Priv only PrivLib is left', await updatesCount() === 1 && /PrivLib/.test(await body()), String(await updatesCount()));
    await pack('3.0.0');
    await manager.locator('span[title="Refresh"] button').click();
    check('after Refresh the new version shows', await wait(async () => /3\.0\.0/.test(await body()), 40), (await body()).slice(0, 400));
} finally { await app.close(); server.close(); }

// With the setting off there is no Sources tab
const off = prepareWorkspace({});
isolateHome(off);
const second = await launch(off);
try {
    await openSolutionExplorer(second.win);
    const manager = await openNuGetManager(second.win);
    check('with the setting off there is no Sources tab', !!manager && await manager.getByRole('tab', { name: 'Sources' }).count() === 0);
} finally { await second.app.close(); }
