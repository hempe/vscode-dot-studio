// manual-testing.md, "New Project / Add New Item with a global.json pinning an older SDK": the New Project wizard shows that SDK's templates and options
// (net8.0 and not net10.0 under the pinned 8.0.130, both without a global.json), and Create works (no "Invalid option(s)", a net8.0 project is written).
// Not covered: Add New Item (reached from the native context menus only).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, findFrame, sh, check } from './lib.mjs';

const sdks = await sh({ folder: '.' }, 'dotnet --list-sdks');
check('an 8.0 SDK and a newer one are installed (the check needs both)', /^8\.0\./m.test(sdks) && /^(9|10)\./m.test(sdks), sdks);

async function wizard(ws, name, body) {
    const { app, win } = await launch(ws);
    try {
        await openSolutionExplorer(win);
        await win.keyboard.press('Control+Shift+p');
        await win.keyboard.type('Create New Project');
        await win.waitForTimeout(1200);
        await win.keyboard.press('Enter');
        const wiz = await findFrame(win, /Create a New Project/, 60);
        if (!wiz) { check(`${name}: the wizard opens`, false); return; }
        await win.waitForTimeout(3000);
        await wiz.getByPlaceholder('Search templates').fill('Console');
        await win.waitForTimeout(800);
        await wiz.locator('[role=listbox] [role=option]').first().click();
        await wiz.getByRole('button', { name: 'Next' }).click();
        await wiz.getByLabel('Project name').waitFor({ timeout: 20000 }).catch(() => {});
        await win.waitForTimeout(2000);
        await body({ win, wiz });
    } finally { await app.close(); }
}

const frameworks = async wiz => {
    const trigger = wiz.getByLabel('framework', { exact: true });
    await trigger.click();
    const list = (await wiz.locator('[role=option]').allTextContents()).map(t => t.trim());
    await wiz.page().keyboard.press('Escape');
    return list;
};

// Pinned to 8.0.130
const pinned = prepareWorkspace({}, { 'global.json': '{"sdk":{"version":"8.0.130","rollForward":"disable"}}' });
await wizard(pinned, 'pinned', async ({ win, wiz }) => {
    const list = await frameworks(wiz);
    check('pinned: the framework option lists net8.0', list.some(t => t.startsWith('net8.0')), JSON.stringify(list));
    check('and not net10.0', !list.some(t => t.startsWith('net10.0')), JSON.stringify(list));
    await wiz.getByRole('button', { name: 'Create', exact: true }).click();
    const created = join(pinned.folder, 'ConsoleApp1', 'ConsoleApp1', 'ConsoleApp1.csproj');
    for (let i = 0; i < 60 && !existsSync(created); i++) await win.waitForTimeout(1000);
    check('pinned: Create writes the project', existsSync(created));
    check('and it targets net8.0', existsSync(created) && /<TargetFramework>net8\.0</.test(readFileSync(created, 'utf8')));
    const text = (await wiz.locator('body').innerText().catch(() => '')) + (await win.locator('.notification-toast').allInnerTexts().catch(() => [])).join(' ');
    check('and says nothing about invalid options', !/Invalid option/i.test(text), text.slice(0, 300));
});

// Without global.json the newest SDK's frameworks are there
const free = prepareWorkspace({});
await wizard(free, 'free', async ({ wiz }) => {
    const list = await frameworks(wiz);
    check('without global.json the framework option lists net10.0', list.some(t => t.startsWith('net10.0')), JSON.stringify(list));
});
