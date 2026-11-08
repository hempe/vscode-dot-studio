// manual-testing.md, "Publish" (the sample's Shop.Web): Publish... starts with "Publish to a folder"; Finish creates Properties/PublishProfiles/FolderProfile.pubxml;
// Publish shows the output in the terminal and "Published. Open folder"; Show all settings: self-contained, linux-x64, single file, Save, publish again (one
// executable); rename and delete; a profile made in Visual Studio shows and publishes (an older one, with the folder as PublishUrl: found that dotnet publish
// ignored it and put the files into the default folder while the tab named PublishUrl's).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, contextMenu, findFrame, answerInput, modal, terminalText, part, settle, check } from './lib.mjs';

const ws = prepareWorkspace({});
const profiles = join(ws.folder, 'src/Shop.Web/Properties/PublishProfiles');
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    const until = async (fn, seconds = 20) => { for (let i = 0; i < seconds * 2; i++) { if (await fn()) return true; await win.waitForTimeout(500); } return false; };
    await expandPath(win, tree, ['Contoso', 'src']);
    await settle(win, tree);
    let panel;
    const open = async () => {
        await contextMenu(win, tree, 'Shop.Web', ['Publish...']);
        panel = await findFrame(win, /Publish Shop\.Web/, 40);
        return panel;
    };
    const body = async () => (await panel.locator('body').innerText()).replace(/\s+/g, ' ');
    const pick = async (id, option) => { await panel.locator(`#${id}`).click(); await panel.getByRole('option', { name: option, exact: true }).click(); await win.waitForTimeout(400); };

    await part('folder profile', async () => {
        check('Publish... opens the tab', !!await open());
        check('it starts with "Publish to a folder"', /Publish to a folder/.test(await body()), (await body()).slice(0, 300));
        const location = panel.locator('#new-location');
        if (!(await location.inputValue()).trim()) await location.fill('bin/Release/publish/');
        console.log(`note: the default folder is ${await location.inputValue()}`);
        await panel.getByRole('button', { name: 'Finish' }).click();
        check('Finish creates Properties/PublishProfiles/FolderProfile.pubxml', await until(() => existsSync(join(profiles, 'FolderProfile.pubxml'))));
        await panel.getByRole('button', { name: 'Publish', exact: true }).click();
        check('Publish ends with "Published. Open folder"', await until(async () => /Published\. Open folder/.test(await body()), 240), (await body()).slice(0, 400));
        const terminal = await terminalText(win);
        check('the output is in the terminal', /dotnet publish|Shop\.Web ->|publish/i.test(terminal), terminal.slice(-300));
    });

    await part('all settings', async () => {
        await panel.getByRole('button', { name: 'Show all settings' }).click();
        await win.waitForTimeout(800);
        await pick('deployment', 'Self-contained');
        await pick('runtime', 'linux-x64');
        await panel.locator('#single-file').check();
        await panel.locator('#delete-existing').check();
        await panel.getByRole('button', { name: 'Save' }).click();
        const xml = () => readFileSync(join(profiles, 'FolderProfile.pubxml'), 'utf8');
        check('Save writes self-contained, linux-x64 and single file into the profile', await until(() => /<SelfContained>true<\/SelfContained>/.test(xml()) && /<RuntimeIdentifier>linux-x64<\/RuntimeIdentifier>/.test(xml()) && /<PublishSingleFile>true<\/PublishSingleFile>/.test(xml())), xml());
        const dir = /<PublishDir>([^<]+)<\/PublishDir>/.exec(xml())?.[1] ?? /<PublishUrl>([^<]+)<\/PublishUrl>/.exec(xml())?.[1];
        await panel.getByRole('button', { name: 'Publish', exact: true }).click();
        // The status still says Published. from the first run: wait for this run to start and end
        check('publishing again starts', await until(async () => /Publishing/.test(await body()), 30), (await body()).slice(0, 300));
        check('and ends with "Published."', await until(async () => /Published\. Open folder/.test(await body()), 400), (await body()).slice(0, 400));
        const out = dir ? join(ws.folder, 'src/Shop.Web', dir.replace(/\\/g, '/')) : '';
        const files = out && existsSync(out) ? readdirSync(out) : [];
        const size = files.includes('Shop.Web') ? statSync(join(out, 'Shop.Web')).size : 0;
        check('the folder holds one executable Shop.Web (self-contained, tens of MB) and no Shop.Web.dll', size > 20e6 && !files.includes('Shop.Web.dll'), JSON.stringify({ out, size, files }));
    });

    await part('rename and delete', async () => {
        await panel.getByText('Rename', { exact: true }).click();
        await answerInput(win, 'Renamed');
        check('Rename renames the .pubxml', await until(() => existsSync(join(profiles, 'Renamed.pubxml')) && !existsSync(join(profiles, 'FolderProfile.pubxml'))), JSON.stringify(readdirSync(profiles)));
        await panel.getByText('Delete', { exact: true }).click();
        const ask = await modal(win);
        check('Delete asks first', !!ask && /Delete the publish profile 'Renamed'\?/.test(ask.text), ask?.text);
        if (ask) await ask.press('Delete');
        check('and deletes the .pubxml', await until(() => !existsSync(join(profiles, 'Renamed.pubxml'))), JSON.stringify(readdirSync(profiles)));
    });

    await part('a profile made in Visual Studio', async () => {
        mkdirSync(profiles, { recursive: true });
        writeFileSync(join(profiles, 'VSProfile.pubxml'), `<?xml version="1.0" encoding="utf-8"?>
<!--
https://go.microsoft.com/fwlink/?LinkID=208121.
-->
<Project>
  <PropertyGroup>
    <DeleteExistingFiles>false</DeleteExistingFiles>
    <ExcludeApp_Data>false</ExcludeApp_Data>
    <LaunchSiteAfterPublish>true</LaunchSiteAfterPublish>
    <LastUsedBuildConfiguration>Release</LastUsedBuildConfiguration>
    <LastUsedPlatform>Any CPU</LastUsedPlatform>
    <PublishProvider>FileSystem</PublishProvider>
    <PublishUrl>bin\\Release\\net10.0\\vs-publish\\</PublishUrl>
    <WebPublishMethod>FileSystem</WebPublishMethod>
    <_TargetId>Folder</_TargetId>
  </PropertyGroup>
</Project>
`);
        await win.keyboard.press('Control+w');
        await win.waitForTimeout(800);
        await open();
        check('the Visual Studio profile shows in the tab', await until(async () => /VSProfile/.test(await body()), 20), (await body()).slice(0, 300));
        await panel.getByRole('button', { name: 'Publish', exact: true }).click();
        check('and publishes', await until(async () => /Published\. Open folder/.test(await body()), 240) && existsSync(join(ws.folder, 'src/Shop.Web/bin/Release/net10.0/vs-publish/Shop.Web.dll')), (await body()).slice(0, 300));
    });
} finally { await app.close(); }
