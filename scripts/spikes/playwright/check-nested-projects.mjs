// manual-testing.md:
// - Exclude/Include in a nested project's folder from the outer tree (Outer/Outer.csproj and Outer/Inner/Inner.csproj, Outer/Inner/Foo.cs): Exclude on Foo.cs under
//   Outer > Inner writes `<Compile Remove="Inner\Foo.cs" />` into Outer.csproj and leaves Inner.csproj; Include takes it out again; Exclude on Foo.cs under the Inner
//   project edits Inner.csproj; Outer > Inner > Sub and Inner > Sub open and close each on their own
// - Directory.Build.props (DefaultItemExcludes) and Directory.Build.targets (Compile Remove): adding and removing them changes the trees of the projects below
//   without a reload (a Compile Remove in Directory.Build.props removes nothing: the SDK's default items come after it)
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, rowsNamed, contextMenuOn, sh, part, settle, check } from './lib.mjs';

const lib = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n';
const ws = prepareWorkspace({}, {
    'nest/Outer/Outer.csproj': lib,
    'nest/Outer/Outer.cs': 'namespace Outer;\n\npublic class O { }\n',
    'nest/Outer/Inner/Inner.csproj': lib,
    'nest/Outer/Inner/Foo.cs': 'namespace Inner;\n\npublic class Foo { }\n',
    'nest/Outer/Inner/Sub/Bar.cs': 'namespace Inner.Sub;\n\npublic class Bar { }\n',
    'src/Shop.Core/Gen/G1.cs': 'namespace Shop.Core.Gen;\n\npublic class G1 { }\n',
    'src/Shop.Worker/Gen/G2.cs': 'namespace Shop.Worker.Gen;\n\npublic class G2 { }\n',
    // An existing Directory.Build.props the projects below src import (edited during the check)
    'src/Directory.Build.props': '<Project>\n</Project>\n',
});
await sh(ws, 'dotnet sln Contoso.slnx add --in-root nest/Outer/Outer.csproj nest/Outer/Inner/Inner.csproj');
const read = p => readFileSync(join(ws.folder, p), 'utf8');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const until = async (fn, seconds = 20) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    // Rows of the same name: the Inner project (depth 1) and Outer's Inner folder (depth 2), and what is below each
    const named = async (name, deeper) => (await rowsNamed(tree, name)).sort((a, b) => deeper ? b.depth - a.depth : a.depth - b.depth)[0]?.locator;
    const open = async locator => { await locator.locator('.expand-icon').first().click(); await win.waitForTimeout(800); };
    const isOpen = async locator => locator.locator('.expand-icon').first().evaluate(e => !e.style.transform.includes('rotate(0deg)'));

    await part('nested project', async () => {
        await expandPath(win, tree, ['Contoso', 'Outer']);
        await settle(win, tree);
        await open(await named('Inner', true));
        await open(await named('Inner', false));
        await settle(win, tree);
        const inner = read('nest/Outer/Inner/Inner.csproj');
        await contextMenuOn(win, await named('Foo.cs', true), ['Exclude From Project']);
        check('Exclude on Foo.cs under Outer > Inner writes <Compile Remove="Inner\\Foo.cs" /> into Outer.csproj', await until(() => /<Compile Remove="Inner\\Foo\.cs" \/>/.test(read('nest/Outer/Outer.csproj'))), read('nest/Outer/Outer.csproj'));
        check('and leaves Inner.csproj as it was', read('nest/Outer/Inner/Inner.csproj') === inner);
        await win.waitForTimeout(1500);
        // Outer's Foo.cs is hidden now (Show All Files off): Include it with Show All Files on
        await tree.getByRole('button', { name: 'Show All Files' }).click();
        await settle(win, tree);
        await contextMenuOn(win, await named('Foo.cs', true), ['Include In Project']);
        check('Include In Project there takes it out again', await until(() => !/Foo\.cs/.test(read('nest/Outer/Outer.csproj'))), read('nest/Outer/Outer.csproj'));
        await tree.getByRole('button', { name: 'Show All Files' }).click();
        await settle(win, tree);
        await contextMenuOn(win, await named('Foo.cs', false), ['Exclude From Project']);
        check('Exclude on Foo.cs under the Inner project edits Inner.csproj', await until(() => /<Compile Remove="Foo\.cs" \/>/.test(read('nest/Outer/Inner/Inner.csproj'))), read('nest/Outer/Inner/Inner.csproj'));
        check('and not Outer.csproj', !/Foo\.cs/.test(read('nest/Outer/Outer.csproj')));

        const outerSub = await named('Sub', true), innerSub = await named('Sub', false);
        await open(outerSub);
        check('opening Outer > Inner > Sub leaves the Inner project\'s Sub closed', await isOpen(outerSub) && !await isOpen(innerSub));
        await open(innerSub);
        await open(outerSub);
        check('opening the Inner project\'s Sub and closing Outer\'s leaves the Inner project\'s open', await isOpen(innerSub) && !await isOpen(outerSub));
    });

    await part('Directory.Build.props', async () => {
        await expandPath(win, tree, ['src', 'Shop.Core', 'Shop.Worker']);
        await settle(win, tree);
        check('both projects show their Gen folder', (await rowsNamed(tree, 'Gen')).length === 2);
        // Directory.Build.props comes before the SDK's default items: there it takes DefaultItemExcludes (a Compile Remove would remove nothing yet);
        // Directory.Build.targets comes after them: there a Compile Remove works
        const props = join(ws.folder, 'src/Directory.Build.props');
        writeFileSync(props, '<Project>\n  <PropertyGroup>\n    <DefaultItemExcludes>$(DefaultItemExcludes);Gen\\**</DefaultItemExcludes>\n  </PropertyGroup>\n</Project>\n');
        check('adding DefaultItemExcludes Gen\\** to src/Directory.Build.props takes Gen out of both trees without a reload', await until(async () => (await rowsNamed(tree, 'Gen')).length === 0, 60));
        writeFileSync(props, '<Project>\n</Project>\n');
        check('removing it brings them back', await until(async () => (await rowsNamed(tree, 'Gen')).length === 2, 60));
        const targets = join(ws.folder, 'src/Directory.Build.targets');
        writeFileSync(targets, '<Project>\n  <ItemGroup>\n    <Compile Remove="Gen\\**" />\n  </ItemGroup>\n</Project>\n');
        check('a new src/Directory.Build.targets with <Compile Remove="Gen\\**" /> takes Gen out of both trees', await until(async () => (await rowsNamed(tree, 'Gen')).length === 0, 60));
        rmSync(targets);
        check('deleting it brings them back', await until(async () => (await rowsNamed(tree, 'Gen')).length === 2, 60));
    });
} finally { await app.close(); }
