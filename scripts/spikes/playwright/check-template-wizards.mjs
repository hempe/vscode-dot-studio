// manual-testing.md, "Test Phase 5 (template wizards)" on the Contoso sample: Add New Project on the solution and on a solution folder (framework, location), Add New
// Item on a folder (a class, an API Controller with read/write actions, a config file), rename a file with nested files (Index.cshtml with Index.cshtml.cs).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, rowInfo, contextMenu, findFrame, modal, renameRow, part, settle, check } from './lib.mjs';

const ws = prepareWorkspace({});
const slnx = () => readFileSync(join(ws.folder, 'Contoso.slnx'), 'utf8');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const until = async (fn, seconds = 30) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web', 'Pages']);
    await settle(win, tree);

    const addItem = async (folder, template, name, configure) => {
        await contextMenu(win, tree, folder, ['Add New Item...']);
        const wiz = await findFrame(win, /Add New Item to/, 60);
        await wiz.getByPlaceholder('Search templates').fill(template);
        await win.waitForTimeout(800);
        await wiz.locator('[role=listbox] [role=option]').filter({ hasText: new RegExp(`^${template}`) }).first().click();
        await win.waitForTimeout(500);
        if (name !== undefined) await wiz.locator('#name').fill(name);
        if (configure) await configure(wiz);
        await wiz.getByRole('button', { name: 'Add', exact: true }).click();
    };

    await part('add new item', async () => {
        const pages = join(ws.folder, 'src/Shop.Web/Pages');
        await addItem('Pages', 'Class', 'Thing');
        check('Add New Item > Class writes Pages/Thing.cs with the folder\'s namespace', await until(() => existsSync(join(pages, 'Thing.cs')) && /namespace Shop\.Web\.Pages/.test(readFileSync(join(pages, 'Thing.cs'), 'utf8'))), existsSync(join(pages, 'Thing.cs')) ? readFileSync(join(pages, 'Thing.cs'), 'utf8') : 'no file');
        check('and the tree shows it', await until(async () => !!await rowInfo(tree, 'Thing.cs')));
        await addItem('Pages', 'API Controller', 'OrdersController', async wiz => { await wiz.locator('#option-actions').check(); });
        const controller = join(pages, 'OrdersController.cs');
        check('API Controller with read/write actions writes the actions (Get, Post, Put, Delete)', await until(() => existsSync(controller) && /\[HttpPost\]/.test(readFileSync(controller, 'utf8')) && /\[HttpPut/.test(readFileSync(controller, 'utf8')) && /\[HttpDelete/.test(readFileSync(controller, 'utf8'))), existsSync(controller) ? readFileSync(controller, 'utf8').slice(0, 300) : 'no file');
        await addItem('Pages', 'Web Config');
        check('a config file (Web Config) is written into the folder', await until(() => existsSync(join(pages, 'web.config'))), JSON.stringify(readdirSync(pages)));
    });

    const addProject = async (node, template, name, framework) => {
        await contextMenu(win, tree, node, ['Add New Project...']);
        const wiz = await findFrame(win, /Add New Project/, 60);
        await win.waitForTimeout(1000);
        await wiz.getByPlaceholder('Search templates').fill(template);
        await win.waitForTimeout(800);
        await wiz.locator('[role=listbox] [role=option]').filter({ hasText: new RegExp(`^${template}`) }).first().click();
        await wiz.getByRole('button', { name: 'Next' }).click();
        await wiz.locator('#name').waitFor({ timeout: 20000 });
        await wiz.locator('#name').fill(name);
        if (framework) {
            await wiz.getByLabel('framework', { exact: true }).click();
            await wiz.getByRole('option', { name: new RegExp(`^${framework}\\b`) }).first().click();
        }
        const location = await wiz.locator('#location').inputValue().catch(() => '');
        await wiz.getByRole('button', { name: 'Create', exact: true }).click();
        return location;
    };

    await part('add new project', async () => {
        const location = await addProject('Contoso', 'Class Library', 'Lib2', 'net8.0');
        const project = join(ws.folder, location, 'Lib2.csproj');
        check('Add New Project on the solution creates the project where the location says (relative to the solution, next to the other projects)', await until(() => existsSync(project), 120), `${location} ${existsSync(project)}`);
        check('with the chosen framework (net8.0)', existsSync(project) && /<TargetFramework>net8\.0<\/TargetFramework>/.test(readFileSync(project, 'utf8')));
        check('and adds it to the solution, outside the solution folders', await until(() => /Lib2\.csproj/.test(slnx()) && !/<Folder[^>]*>[^]*?Lib2\.csproj[^]*?<\/Folder>/.test(slnx()), 30), slnx());
        await settle(win, tree);
        const toolLocation = await addProject('src', 'Console App', 'Tool2');
        const tool = join(ws.folder, toolLocation, 'Tool2.csproj');
        check('Add New Project on the solution folder src creates the project', await until(() => existsSync(tool), 120), `${toolLocation}`);
        check('inside src in the solution file', await until(() => /<Folder Name="\/src\/">[^]*?Tool2\.csproj[^]*?<\/Folder>/.test(slnx()), 30), slnx());
    });

    await part('rename with nested files', async () => {
        const pages = join(ws.folder, 'src/Shop.Web/Pages');
        await renameRow(win, tree, 'Privacy.cshtml', 'Policy.cshtml');
        const ask = await modal(win, 5);
        if (ask) { console.log(`note: renaming asked "${ask.text}"`); await ask.press(/No|Skip/.test(ask.text) ? 'No' : 'Cancel').catch(() => {}); }
        check('renaming Privacy.cshtml renames its nested Privacy.cshtml.cs too', await until(() => existsSync(join(pages, 'Policy.cshtml')) && existsSync(join(pages, 'Policy.cshtml.cs')) && !existsSync(join(pages, 'Privacy.cshtml.cs'))), JSON.stringify(readdirSync(pages)));
    });
} finally { await app.close(); }
