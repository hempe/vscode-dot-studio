// manual-testing.md, Exclude From Project / Include In Project (from the context menu, Show All Files on for the excluded rows):
// - a file: `<Compile Remove>` written with the formatting kept, the file leaves the tree (greyed out with Show All Files); Include deletes the Remove again;
//   a folder: `Remove="Dir\**"`; a file left out by DefaultItemExcludes gets an Include item; linked files and old-style projects show neither entry;
//   excluding Index.cshtml.cs under Index.cshtml leaves the parent alone
// - the project decides the file elsewhere: an Include in Directory.Build.targets: the Remove is written and a warning says other items decide it; an explicit
//   Include in the .csproj: the Remove goes after it and the file leaves the tree
// - Include on a big folder left out by DefaultItemExcludes (> 200 files): a modal asks "Include N files?", Cancel writes nothing; .git, .vs, node_modules, bin,
//   obj and .user files get no Include
// - no Exclude on an empty folder, a folder of only linked files, the folder of a nested project
// - a block-form `<Compile Remove="Block.cs"></Compile>`: Include deletes it (and the empty ItemGroup), Exclude writes one self-closing Remove
// - Include picks the item type (Content with CopyToPublishDirectory / CopyToOutputDirectory, Compile, EmbeddedResource, None); the Razor page answers; in a
//   console project the .cshtml becomes None
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, rowByName, rowsNamed, contextMenu, contextMenuOn, menuLabels, modal, waitForToast, clearToasts, sh, part, settle, check,
} from './lib.mjs';

const sample = join(import.meta.dirname, '../../screenshots/sample');
const core = readFileSync(join(sample, 'src/Shop.Core/Shop.Core.csproj'), 'utf8').replace('</Project>', `  <PropertyGroup>
    <DefaultItemExcludes>$(DefaultItemExcludes);Skipped\\**;Big\\**</DefaultItemExcludes>
  </PropertyGroup>

  <ItemGroup>
    <Compile Include="..\\Shared\\Linked.cs" Link="Linked\\Linked.cs" />
    <Compile Include="Explicit.cs" />
  </ItemGroup>

  <ItemGroup>
    <Compile Remove="Block.cs"></Compile>
  </ItemGroup>

</Project>`);
const web = readFileSync(join(sample, 'src/Shop.Web/Shop.Web.csproj'), 'utf8').replace('</Project>', `  <PropertyGroup>
    <DefaultItemExcludes>$(DefaultItemExcludes);Pages\\Legacy\\**</DefaultItemExcludes>
  </PropertyGroup>

</Project>`);
const files = {
    'src/Shop.Core/Shop.Core.csproj': core,
    'src/Shop.Core/Exclude/A.cs': 'namespace Shop.Core.Exclude;\n\npublic class A { }\n',
    'src/Shop.Core/Exclude/notes.txt': 'notes\n',
    'src/Shop.Core/Skipped/B.cs': 'namespace Shop.Core.Skipped;\n\npublic class B { }\n',
    'src/Shop.Core/Explicit.cs': 'namespace Shop.Core;\n\npublic class Explicit { }\n',
    'src/Shop.Core/FromTargets.cs': 'namespace Shop.Core;\n\npublic class FromTargets { }\n',
    'src/Shop.Core/Directory.Build.targets': '<Project>\n  <ItemGroup>\n    <Compile Include="FromTargets.cs" />\n  </ItemGroup>\n</Project>\n',
    'src/Shop.Core/Block.cs': 'namespace Shop.Core;\n\npublic class Block { }\n',
    'src/Shared/Linked.cs': 'namespace Shop.Shared;\n\npublic class Linked { }\n',
    'src/Shop.Web/Shop.Web.csproj': web,
    'src/Shop.Web/Pages/Legacy/Hello.cshtml': '@page\n@model Shop.Web.Pages.Legacy.HelloModel\n<p>Hello legacy</p>\n',
    'src/Shop.Web/Pages/Legacy/Hello.cshtml.cs': 'using Microsoft.AspNetCore.Mvc.RazorPages;\n\nnamespace Shop.Web.Pages.Legacy;\n\npublic class HelloModel : PageModel { }\n',
    'src/Shop.Web/Pages/Legacy/Strings.resx': '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>\n  <resheader name="version"><value>2.0</value></resheader>\n  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>\n  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>\n</root>\n',
    'src/Shop.Web/Pages/Legacy/data.json': '{ "a": 1 }\n',
    'src/Shop.Web/Pages/Legacy/notes.txt': 'notes\n',
    'src/Shop.Web/Tools/Tools.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n',
    'src/Shop.Web/Tools/Tool.cs': 'namespace Shop.Web.Tools;\n\npublic class Tool { }\n',
    'src/Legacy/Legacy.csproj': '<?xml version="1.0" encoding="utf-8"?>\n<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n  <PropertyGroup>\n    <OutputType>Library</OutputType>\n    <TargetFrameworkVersion>v4.8</TargetFrameworkVersion>\n  </PropertyGroup>\n  <ItemGroup>\n    <Compile Include="Class1.cs" />\n  </ItemGroup>\n  <Import Project="$(MSBuildToolsPath)\\Microsoft.CSharp.targets" />\n</Project>\n',
    'src/Legacy/Class1.cs': 'namespace Legacy { public class Class1 { } }\n',
    'src/NewConsole/NewConsole.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <DefaultItemExcludes>$(DefaultItemExcludes);Legacy\\**</DefaultItemExcludes>\n  </PropertyGroup>\n</Project>\n',
    'src/NewConsole/Program.cs': 'System.Console.WriteLine("hi");\n',
    'src/NewConsole/Legacy/Hello.cshtml': '<p>Hello</p>\n',
};
for (let i = 0; i < 210; i++) files[`src/Shop.Core/Big/F${i}.cs`] = `namespace Shop.Core.Big;\n\npublic class F${i} { }\n`;
for (const f of ['.git/HEAD', '.vs/state.json', 'node_modules/x.js', 'bin/x.dll', 'obj/x.json', 'Big.csproj.user']) files[`src/Shop.Core/Big/${f}`] = 'x\n';
const ws = prepareWorkspace({}, files);
mkdirSync(join(ws.folder, 'src/Shop.Core/Empty'), { recursive: true });
await sh(ws, 'dotnet sln Contoso.slnx add --solution-folder src src/Shop.Web/Tools/Tools.csproj src/Legacy/Legacy.csproj src/NewConsole/NewConsole.csproj');
const read = p => readFileSync(join(ws.folder, p), 'utf8');
const coreProj = 'src/Shop.Core/Shop.Core.csproj', webProj = 'src/Shop.Web/Shop.Web.csproj';

const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const showAll = tree.getByRole('button', { name: 'Show All Files' });
    const until = async (fn, seconds = 20) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    const greyed = async name => /\bexcluded\b/.test(await rowByName(tree, name).evaluate(e => e.className).catch(() => ''));
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Core', 'Exclude']);
    await settle(win, tree);

    await part('a file', async () => {
        const before = read(coreProj);
        await contextMenu(win, tree, 'A.cs', ['Exclude From Project']);
        check('Exclude on A.cs writes <Compile Remove="Exclude\\A.cs" />', await until(() => /<Compile Remove="Exclude\\A\.cs" \/>/.test(read(coreProj))), read(coreProj));
        check('the rest of the project file is unchanged (lines kept)', before.split('\n').filter(l => l.trim()).every(l => read(coreProj).includes(l)));
        check('A.cs leaves the tree', await until(async () => !await rowInfo(tree, 'A.cs')));
        await showAll.click();
        check('with Show All Files it shows greyed out', await until(async () => !!await rowInfo(tree, 'A.cs') && await greyed('A.cs')));
        await contextMenu(win, tree, 'A.cs', ['Include In Project']);
        check('Include In Project deletes the Remove again (the file as before)', await until(() => read(coreProj) === before), read(coreProj));
    });

    await part('a folder', async () => {
        const before = read(coreProj);
        await contextMenu(win, tree, 'Exclude', ['Exclude From Project']);
        check('Exclude on a folder writes Remove="Exclude\\**" (Compile and None)', await until(() => /<Compile Remove="Exclude\\\*\*" \/>/.test(read(coreProj)) && /<None Remove="Exclude\\\*\*" \/>/.test(read(coreProj))), read(coreProj));
        await win.waitForTimeout(1500);
        await contextMenu(win, tree, 'Exclude', ['Include In Project']);
        check('Include deletes them again', await until(() => read(coreProj) === before), read(coreProj));
    });

    await part('DefaultItemExcludes', async () => {
        await expandPath(win, tree, ['Skipped']);
        await contextMenu(win, tree, 'B.cs', ['Include In Project']);
        check('a file left out by DefaultItemExcludes gets an Include item', await until(() => /<Compile Include="Skipped\\B\.cs" \/>/.test(read(coreProj))), read(coreProj));
    });

    await part('no entry', async () => {
        await expandPath(win, tree, ['Linked']);
        const linked = await menuLabels(win, tree, 'Linked.cs');
        check('a linked file has neither Exclude nor Include', !linked.some(l => /Exclude From Project|Include In Project/.test(l)), JSON.stringify(linked));
        const empty = await menuLabels(win, tree, 'Empty');
        check('an empty folder has no Exclude', !empty.includes('Exclude From Project'), JSON.stringify(empty));
        const linkedFolder = await menuLabels(win, tree, 'Linked');
        check('a folder of only linked files has no Exclude', !linkedFolder.includes('Exclude From Project'), JSON.stringify(linkedFolder));
        await expandPath(win, tree, ['Legacy']);
        const old = (await menuLabels(win, tree, 'Class1.cs'));
        check('an old-style project\'s file has neither entry', !old.some(l => /Exclude From Project|Include In Project/.test(l)), JSON.stringify(old));
    });

    await part('decided elsewhere', async () => {
        await contextMenu(win, tree, 'FromTargets.cs', ['Exclude From Project']);
        check('Exclude on a file Directory.Build.targets includes: the Remove is written', await until(() => /<Compile Remove="FromTargets\.cs" \/>/.test(read(coreProj))), read(coreProj));
        check('and a warning says other items decide it', !!await waitForToast(win, /other items decide it/, 20), JSON.stringify(await win.locator('.notification-toast').allInnerTexts()));
        await clearToasts(win);
        await contextMenu(win, tree, 'Explicit.cs', ['Exclude From Project']);
        check('Exclude on an explicitly included file: the Remove goes after the Include', await until(() => /<Compile Include="Explicit\.cs" \/>[\s\S]*<Compile Remove="Explicit\.cs" \/>/.test(read(coreProj))), read(coreProj));
        check('and the file is greyed out (out of the project)', await until(async () => await greyed('Explicit.cs')));
    });

    await part('block-form Remove', async () => {
        check('Block.cs starts out greyed out', await until(async () => !!await rowInfo(tree, 'Block.cs') && await greyed('Block.cs')));
        await contextMenu(win, tree, 'Block.cs', ['Include In Project']);
        check('Include deletes the block-form Remove and its empty ItemGroup, adds no Include', await until(() => !/Block\.cs/.test(read(coreProj)) && !/<ItemGroup>\s*<\/ItemGroup>/.test(read(coreProj))), read(coreProj));
        await win.waitForTimeout(1500);
        await contextMenu(win, tree, 'Block.cs', ['Exclude From Project']);
        check('Exclude again writes one self-closing Remove', await until(() => (read(coreProj).match(/<Compile Remove="Block\.cs" \/>/g) ?? []).length === 1 && !/<\/Compile>/.test(read(coreProj))), read(coreProj));
    });

    await part('big folder', async () => {
        const before = read(coreProj);
        await contextMenu(win, tree, 'Big', ['Include In Project']);
        const ask = await modal(win, 20);
        check('Include on a folder of 210 files asks "Include 210 files?"', !!ask && /Include 210 files\?/.test(ask.text), ask?.text);
        if (ask) await ask.press('Cancel');
        await win.waitForTimeout(1500);
        check('Cancel writes nothing', read(coreProj) === before);
        await contextMenu(win, tree, 'Big', ['Include In Project']);
        const again = await modal(win, 20);
        if (again) await again.press('Include');
        check('Include writes an Include for each file', await until(() => (read(coreProj).match(/<Compile Include="Big\\F\d+\.cs" \/>/g) ?? []).length === 210, 40), String((read(coreProj).match(/Big\\F/g) ?? []).length));
        check('and none for .git, .vs, node_modules, bin, obj and .user files', !/Big\\(\.git|\.vs|node_modules|bin|obj)\\|Big\.csproj\.user/.test(read(coreProj)));
    });

    await part('item types', async () => {
        await expandPath(win, tree, ['Shop.Web', 'Pages']);
        const nested = await menuLabels(win, tree, 'Tools');
        check('the folder of a nested project (Shop.Web/Tools) has no Exclude', !nested.includes('Exclude From Project'), JSON.stringify(nested));
        // Three rows are called Legacy: the old-style project, Shop.Web/Pages/Legacy (the deepest) and later NewConsole/Legacy
        const pagesLegacy = (await rowsNamed(tree, 'Legacy')).sort((a, b) => b.depth - a.depth)[0];
        await contextMenuOn(win, pagesLegacy.locator, ['Include In Project']);
        const ok = await until(() => /Hello\.cshtml\.cs/.test(read(webProj)), 30);
        const text = read(webProj);
        check('Include on Pages/Legacy: Content for Hello.cshtml with CopyToPublishDirectory', ok && /<Content Include="Pages\\Legacy\\Hello\.cshtml"[^>]*CopyToPublishDirectory=/.test(text), text);
        check('Content for data.json with CopyToOutputDirectory', /<Content Include="Pages\\Legacy\\data\.json"[^>]*CopyToOutputDirectory=/.test(text));
        check('Compile for Hello.cshtml.cs, EmbeddedResource for Strings.resx, None for notes.txt', /<Compile Include="Pages\\Legacy\\Hello\.cshtml\.cs"/.test(text) && /<EmbeddedResource Include="Pages\\Legacy\\Strings\.resx"/.test(text) && /<None Include="Pages\\Legacy\\notes\.txt"/.test(text));
        const run = await sh(ws, `timeout 120 bash -c 'dotnet run --project src/Shop.Web --no-launch-profile --urls http://127.0.0.1:5198 > /tmp/pw-legacy-run.log 2>&1 & pid=$!; for i in $(seq 1 80); do sleep 1; r=$(curl -s http://127.0.0.1:5198/Legacy/Hello) && [ -n "$r" ] && break; done; echo "answer:$r"; kill $pid; pkill -f "Shop.Web.dll --urls http://127.0.0.1:5198" || true'`);
        check('/Legacy/Hello answers', /Hello legacy/.test(run), run.slice(-300) + readFileSync('/tmp/pw-legacy-run.log', 'utf8').slice(-400));
        await expandPath(win, tree, ['NewConsole']);
        await win.waitForTimeout(800);
        // NewConsole/Legacy is neither the old-style project (the shallowest) nor Shop.Web/Pages/Legacy (the deepest)
        const consoleLegacy = (await rowsNamed(tree, 'Legacy')).sort((a, b) => a.depth - b.depth)[1];
        await contextMenuOn(win, consoleLegacy.locator, ['Include In Project']);
        check('in a console project the .cshtml becomes None', await until(() => /<None Include="Legacy\\Hello\.cshtml"/.test(read('src/NewConsole/NewConsole.csproj')), 20), read('src/NewConsole/NewConsole.csproj'));
    });

    await part('Index.cshtml.cs', async () => {
        await expandPath(win, tree, ['Shop.Web', 'Pages', 'Index.cshtml']);
        await win.waitForTimeout(1000);
        check('after the Include in Pages, Index.cshtml still shows Index.cshtml.cs under it (before: an open row without children)', (await rowsNamed(tree, 'Index.cshtml.cs')).length === 1);
        await contextMenu(win, tree, 'Index.cshtml.cs', ['Exclude From Project']);
        check('excluding Index.cshtml.cs under Index.cshtml writes its Remove only', await until(() => /<Compile Remove="Pages\\Index\.cshtml\.cs" \/>/.test(read(webProj))) && !/Remove="Pages\\Index\.cshtml"/.test(read(webProj)), read(webProj));
        check('and leaves the parent alone (not greyed out)', !!await rowInfo(tree, 'Index.cshtml') && !await greyed('Index.cshtml'));
    });
} finally { await app.close(); }
