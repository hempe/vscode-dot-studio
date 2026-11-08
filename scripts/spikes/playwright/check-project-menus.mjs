// manual-testing.md, entries that start from the Solution Explorer's context menu (drawn in the page with window.menuStyle custom):
// - Solution folders (.sln and .slnx): Add Solution Folder with a name the folder next to it has (also in another case) shows an error and leaves the file alone;
//   Rename to a taken name does the same; the same name under another parent works
// - Unload Project: the project greys out as "(unloaded)" without children; Build on the solution skips it; Reload Project brings it back; survives a restart;
//   .sln and .slnx
// - Pack only on libraries (not on web, worker or test projects); the message names the .nupkg with Reveal in Explorer and Copy Path; IsPackable false warns
// - Open Launch Settings: opens Shop.Web's file; creates one for a new console project (a profile named after it) and http/https for a new web project without one;
//   Set as Startup Project then offers the new profiles; not offered on libraries and test projects
// - Manage User Secrets: adds <UserSecretsId>, opens an empty secrets.json; a value there reaches the app in Development; the second time the same file
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, rowByName, contextMenu, menuLabels, answerInput, quickItems, quickInput,
    waitForToast, clearToasts, editorTabs, isolateHome, sh, part, toSln, renameRow, check,
} from './lib.mjs';

const solutionText = ws => readFileSync(join(ws.folder, existsSync(join(ws.folder, 'Contoso.slnx')) ? 'Contoso.slnx' : 'Contoso.sln'), 'utf8');

for (const kind of ['slnx', 'sln']) {
    const ws = prepareWorkspace({});
    if (kind === 'sln') await toSln(ws);
    let { app, win } = await launch(ws);
    try {
        let tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Contoso']);
        await part(`[${kind}] solution folders`, async () => {
            const before = solutionText(ws);
            for (const name of ['src', 'SRC']) {
                await contextMenu(win, tree, 'Contoso', ['Add Solution Folder']);
                await answerInput(win, name);
                const toast = await waitForToast(win, /already exists/, 10);
                check(`[${kind}] Add Solution Folder "${name}" next to src: an error`, !!toast, JSON.stringify(await win.locator('.notification-toast').allInnerTexts()));
                check(`[${kind}] and the file is unchanged`, solutionText(ws) === before);
                await clearToasts(win);
            }
            await renameRow(win, tree, 'tests', 'src');
            check(`[${kind}] Rename tests to src: an error`, !!await waitForToast(win, /already|exists|taken/i, 10), JSON.stringify(await win.locator('.notification-toast').allInnerTexts()));
            check(`[${kind}] and the file is unchanged`, solutionText(ws) === before);
            await clearToasts(win);
            await contextMenu(win, tree, 'tests', ['Add Solution Folder']);
            await answerInput(win, 'src');
            await win.waitForTimeout(2500);
            const after = solutionText(ws);
            check(`[${kind}] the same name under another parent works (tests/src)`, kind === 'slnx' ? /Name="\/tests\/src\/"/.test(after) : (after.match(/= "src", "src"/g) ?? []).length === 2, after.slice(0, 600));
        });

        await part(`[${kind}] unload project`, async () => {
            await expandPath(win, tree, ['src']);
            await contextMenu(win, tree, 'Shop.Worker', ['Unload Project']);
            await win.waitForTimeout(2000);
            const unloaded = await rowInfo(tree, 'Shop.Worker (unloaded)');
            check(`[${kind}] Unload Project: the row says "(unloaded)" and has no children`, !!unloaded && !unloaded.expandable, JSON.stringify(unloaded));
            check(`[${kind}] and it is greyed out (class unloaded)`, await tree.locator('.tree-node.unloaded').count() === 1);
            const menu = await menuLabels(win, tree, 'Shop.Worker (unloaded)');
            check(`[${kind}] its menu offers Reload Project and no Build`, menu.includes('Reload Project') && !menu.includes('Build'), JSON.stringify(menu));
            for (const p of ['Shop.Worker', 'Shop.Core']) rmSync(join(ws.folder, 'src', p, 'bin'), { recursive: true, force: true });
            await contextMenu(win, tree, 'Contoso', ['Build']);
            const coreBin = join(ws.folder, 'src/Shop.Core/bin');
            for (let i = 0; i < 90 && !existsSync(coreBin); i++) await win.waitForTimeout(1000);
            await win.waitForTimeout(8000);
            check(`[${kind}] Build on the solution builds Shop.Core and skips Shop.Worker`, existsSync(coreBin) && !existsSync(join(ws.folder, 'src/Shop.Worker/bin')));
        });

        // A restart keeps it unloaded
        await app.close();
        ({ app, win } = await launch(ws));
        tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Contoso', 'src']);
        await part(`[${kind}] unload survives a restart`, async () => {
            check(`[${kind}] after a restart Shop.Worker is still unloaded`, !!await rowInfo(tree, 'Shop.Worker (unloaded)'));
            await contextMenu(win, tree, 'Shop.Worker (unloaded)', ['Reload Project']);
            await win.waitForTimeout(2500);
            const back = await rowInfo(tree, 'Shop.Worker');
            check(`[${kind}] Reload Project brings it back with its children`, !!back && back.expandable && await tree.locator('.tree-node.unloaded').count() === 0, JSON.stringify(back));
        });
    } finally { await app.close(); }
}

// Pack, launch settings and user secrets on the .slnx
{
    const ws = prepareWorkspace({});
    const home = isolateHome(ws);
    await sh(ws, 'dotnet new console -n NewConsole -o src/NewConsole');
    await sh(ws, 'dotnet new web -n NewWeb -o src/NewWeb');
    rmSync(join(ws.folder, 'src/NewWeb/Properties'), { recursive: true, force: true });
    await sh(ws, 'dotnet sln Contoso.slnx add --solution-folder src src/NewConsole/NewConsole.csproj src/NewWeb/NewWeb.csproj');
    // An endpoint that shows a configuration value, for the user secret
    const program = join(ws.folder, 'src/Shop.Web/Program.cs');
    writeFileSync(program, readFileSync(program, 'utf8').replace('app.Run();', 'app.MapGet("/greeting", (IConfiguration c) => c["Greeting"] ?? "none");\napp.Run();'));
    const { app, win } = await launch(ws);
    try {
        const tree = await openSolutionExplorer(win);
        await expandPath(win, tree, ['Contoso', 'src', 'tests']);
        await win.waitForTimeout(1000);

        await part('pack', async () => {
            const packs = {};
            for (const name of ['Shop.Core', 'Shop.Web', 'Shop.Worker', 'Shop.Core.Tests', 'NewConsole']) packs[name] = (await menuLabels(win, tree, name)).includes('Pack');
            check('Pack is on the library only (Shop.Core), not on web, worker, console and test projects', JSON.stringify(packs) === JSON.stringify({ 'Shop.Core': true, 'Shop.Web': false, 'Shop.Worker': false, 'Shop.Core.Tests': false, NewConsole: false }), JSON.stringify(packs));
            await contextMenu(win, tree, 'Shop.Core', ['Pack']);
            const packed = await waitForToast(win, /Packed .*\.nupkg/, 120);
            check('Pack on Shop.Core: the message names the .nupkg', !!packed, JSON.stringify(await win.locator('.notification-toast').allInnerTexts()));
            if (packed) {
                const text = await packed.innerText();
                check('with Reveal in Explorer and Copy Path', /Reveal in Explorer/.test(text) && /Copy Path/.test(text), text);
            }
            await clearToasts(win);
            const csproj = join(ws.folder, 'src/Shop.Core/Shop.Core.csproj');
            writeFileSync(csproj, readFileSync(csproj, 'utf8').replace('</Project>', '  <PropertyGroup>\n    <IsPackable>false</IsPackable>\n  </PropertyGroup>\n</Project>'));
            rmSync(join(ws.folder, 'src/Shop.Core/bin'), { recursive: true, force: true });
            await win.waitForTimeout(2000);
            await contextMenu(win, tree, 'Shop.Core', ['Pack']);
            check('with <IsPackable>false</IsPackable> it warns instead', !!await waitForToast(win, /wrote no package|IsPackable/, 120), JSON.stringify(await win.locator('.notification-toast').allInnerTexts()));
            await clearToasts(win);
        });

        await part('open launch settings', async () => {
            const has = async name => (await menuLabels(win, tree, name)).includes('Open Launch Settings');
            check('Open Launch Settings is not on the library nor the test project', !await has('Shop.Core') && !await has('Shop.Core.Tests'));
            await contextMenu(win, tree, 'Shop.Web', ['Open Launch Settings']);
            await win.waitForTimeout(2000);
            check('on Shop.Web it opens Properties/launchSettings.json', (await editorTabs(win)).includes('launchSettings.json'), JSON.stringify(await editorTabs(win)));
            const consoleFile = join(ws.folder, 'src/NewConsole/Properties/launchSettings.json');
            await contextMenu(win, tree, 'NewConsole', ['Open Launch Settings']);
            for (let i = 0; i < 20 && !existsSync(consoleFile); i++) await win.waitForTimeout(500);
            check('on a new console project it creates one with a profile named after the project', existsSync(consoleFile) && /"NewConsole"\s*:/.test(readFileSync(consoleFile, 'utf8')), existsSync(consoleFile) ? readFileSync(consoleFile, 'utf8') : 'no file');
            const webFile = join(ws.folder, 'src/NewWeb/Properties/launchSettings.json');
            await contextMenu(win, tree, 'NewWeb', ['Open Launch Settings']);
            for (let i = 0; i < 20 && !existsSync(webFile); i++) await win.waitForTimeout(500);
            const web = existsSync(webFile) ? readFileSync(webFile, 'utf8') : '';
            check('on a new web project it creates http and https profiles', /"http"\s*:/.test(web) && /"https"\s*:/.test(web), web || 'no file');
            await contextMenu(win, tree, 'NewWeb', ['Set as Startup Project']);
            const offered = await quickItems(win);
            check('Set as Startup Project then offers the new profiles', offered.some(i => /^http /.test(i)) && offered.some(i => /^https /.test(i)), JSON.stringify(offered));
            if (await quickInput(win, 1)) await win.keyboard.press('Escape');
        });

        await part('user secrets', async () => {
            const csproj = join(ws.folder, 'src/Shop.Web/Shop.Web.csproj');
            await contextMenu(win, tree, 'Shop.Web', ['Manage User Secrets']);
            let id;
            for (let i = 0; i < 60 && !id; i++) { id = /<UserSecretsId>([^<]+)<\/UserSecretsId>/.exec(readFileSync(csproj, 'utf8'))?.[1]; if (!id) await win.waitForTimeout(500); }
            check('Manage User Secrets adds <UserSecretsId>', !!id);
            await win.waitForTimeout(2000);
            check('and opens secrets.json', (await editorTabs(win)).includes('secrets.json'), JSON.stringify(await editorTabs(win)));
            const secrets = join(home, '.microsoft/usersecrets', id ?? 'none', 'secrets.json');
            check('which is empty (in the user secrets folder of HOME)', existsSync(secrets) && /^\s*(\{\s*\})?\s*$/.test(readFileSync(secrets, 'utf8')), existsSync(secrets) ? readFileSync(secrets, 'utf8') : 'no file');
            writeFileSync(secrets, '{ "Greeting": "hi" }');
            const run = await sh(ws, `timeout 60 bash -c 'ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Shop.Web --no-launch-profile --urls http://127.0.0.1:5197 > /tmp/pw-secrets-run.log 2>&1 & pid=$!; for i in $(seq 1 50); do sleep 1; r=$(curl -s http://127.0.0.1:5197/greeting) && [ -n "$r" ] && break; done; echo "answer:$r"; kill $pid; pkill -f "Shop.Web.dll --urls http://127.0.0.1:5197" || true'`);
            check('a value there reaches the app in Development', /answer:hi/.test(run), run.slice(-300));
            await contextMenu(win, tree, 'Shop.Web', ['Manage User Secrets']);
            await win.waitForTimeout(2500);
            check('the second time: the same id, the same file', (readFileSync(csproj, 'utf8').match(/<UserSecretsId>/g) ?? []).length === 1 && readFileSync(secrets, 'utf8').includes('hi'));
        });
    } finally { await app.close(); }
}
