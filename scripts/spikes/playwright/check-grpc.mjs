// manual-testing.md, gRPC references (copies of src/__fixtures__/grpc):
// - the tree: Consumer's Connected Services (plug icon) above Dependencies with greet.proto (Client), money.proto (None), remote.proto (Client); double-click and
//   Enter open the file; Client and Web have none; a Protobuf item written by hand brings the node, Server -> Both relabels it; a WCF reference folder lists first
// - Add gRPC reference from a file (Client): the kinds WCF and gRPC (WCF goes on to the WSDL question); the item with Link, Google.Protobuf, Grpc.Net.ClientFactory,
//   Grpc.Tools (PrivateAssets); Connected Services and Protos > greet.proto with the link badge; dotnet build generates GreeterClient; the same file again: already;
//   removing the last reference takes Connected Services away
// - from a URL in a web project: Protos/greet.proto downloaded, <SourceUrl>, only Grpc.AspNetCore; under Central Package Management the versions go to
//   Directory.Packages.props; a download that fails offers Show Output and changes nothing; an HTML page is refused and the existing file stays; Cancel on the download
//   stops it without an error; a file added while the package source cannot be reached: the item is written and the packages failed; again once reachable adds the packages
// - Update and Remove (Consumer): Update only on remote.proto; Update replaces the file and says so, a second says up to date (time stamp kept); Remove asks, the whole
//   block leaves the project, the file stays; Remove on money.proto names the wildcard and changes nothing
// - an older Google.Protobuf (3.20.0 in Web): asks to raise it; Raise sets the version and adds Grpc.AspNetCore and dotnet build works; Cancel adds only the item and
//   says to raise it; under Central Package Management the PackageVersion is raised
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    prepareFixture, launch, openSolutionExplorer, expandPath, rowInfo, rowsNamed, contextMenu, contextMenuOn, menuLabels, pickQuick, answerInput, quickItems,
    quickInput, modal, waitForToast, clearToasts, editorTabs, runCommand, isolateHome, sh, part, settle, startServer, repo, check,
} from './lib.mjs';

const GITHUB_PROTO = 'https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto';
const read = (ws, p) => readFileSync(join(ws.folder, p), 'utf8');
const toastsText = async win => JSON.stringify(await win.locator('.notification-toast').allInnerTexts());

async function withWindow(ws, fn) {
    const { app, win } = await launch(ws);
    try {
        const tree = await openSolutionExplorer(win);
        const until = async (f, seconds = 20) => { for (let i = 0; i < seconds * 2; i++) { if (await f()) return true; await win.waitForTimeout(500); } return false; };
        // The rows one level below the nth row of that name
        const below = async (name, nth = 0) => {
            const rows = await tree.locator('.tree-node').evaluateAll(l => l.map(e => ({ name: e.textContent.trim(), depth: parseFloat(getComputedStyle(e).paddingLeft) || 0 })));
            const at = rows.map((r, i) => r.name === name ? i : -1).filter(i => i >= 0)[nth] ?? -1;
            const out = [];
            for (let i = at + 1; at >= 0 && i < rows.length && rows[i].depth > rows[at].depth; i++) if (rows[i].depth === rows[at + 1].depth) out.push(rows[i].name);
            return out;
        };
        await fn({ win, tree, until, below });
    } finally { await app.close(); }
}

// Adds a gRPC reference through the menu: the project, file or url, what to generate (undefined: the preselected first)
async function addGrpc(win, tree, project, source, services) {
    await contextMenu(win, tree, project, ['Add Service Reference...']);
    await pickQuick(win, /^gRPC/);
    if (source.file) {
        await pickQuick(win, /Browse for \.proto File/);
        await answerInput(win, source.file);
    } else {
        await pickQuick(win, /Enter URL/);
        await answerInput(win, source.url);
    }
    const items = await quickItems(win);
    if (services) await pickQuick(win, new RegExp(`^${services}\\b`)); else await win.keyboard.press('Enter');
    return items;
}

// The tree
await part('tree', async () => {
    const ws = prepareFixture('grpc');
    await withWindow(ws, async ({ win, tree, until, below }) => {
        await expandPath(win, tree, ['Grpc', 'Consumer']);
        await settle(win, tree);
        const consumer = await below('Consumer');
        check('Consumer starts with Connected Services, then Dependencies', consumer[0] === 'Connected Services' && consumer[1] === 'Dependencies', JSON.stringify(consumer));
        const connected = (await rowsNamed(tree, 'Connected Services'))[0].locator;
        check('with the plug icon', await connected.locator('.codicon-plug, [class*="plug"]').count() > 0 || /plug/.test(await connected.innerHTML()));
        await expandPath(win, tree, ['Connected Services']);
        await win.waitForTimeout(800);
        const refs = await below('Connected Services');
        check('it lists greet.proto (Client), money.proto (None), remote.proto (Client)', JSON.stringify(refs) === JSON.stringify(['greet.proto (Client)', 'money.proto (None)', 'remote.proto (Client)']), JSON.stringify(refs));
        await (await rowsNamed(tree, 'greet.proto (Client)'))[0].locator.dblclick();
        check('double-click opens greet.proto', await until(async () => (await editorTabs(win)).includes('greet.proto'), 10), JSON.stringify(await editorTabs(win)));
        await runCommand(win, 'View: Close All Editors');
        await win.waitForTimeout(800);
        await (await rowsNamed(tree, 'money.proto (None)'))[0].locator.click();
        await win.waitForTimeout(500);
        await win.keyboard.press('Enter');
        check('Enter opens money.proto', await until(async () => (await editorTabs(win)).includes('money.proto'), 10), JSON.stringify(await editorTabs(win)));
        await expandPath(win, tree, ['Client', 'Web']);
        await settle(win, tree);
        check('Client and Web have no Connected Services node', !(await below('Client')).includes('Connected Services') && !(await below('Web')).includes('Connected Services'), JSON.stringify([await below('Client'), await below('Web')]));
        const client = join(ws.folder, 'Client/Client.csproj');
        writeFileSync(client, readFileSync(client, 'utf8').replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Server" />\n  </ItemGroup>\n\n</Project>'));
        check('a <Protobuf> item written by hand into Client brings its Connected Services node', await until(async () => (await below('Client')).includes('Connected Services'), 40), JSON.stringify(await below('Client')));
        // Client comes before Consumer in the tree: its Connected Services is the first of the two
        const clientConnected = (await rowsNamed(tree, 'Connected Services'))[0]?.locator;
        if (clientConnected) { await clientConnected.locator('.expand-icon').first().click(); await win.waitForTimeout(800); }
        check('listing greet.proto (Server)', await until(async () => (await rowsNamed(tree, 'greet.proto (Server)')).length === 1, 10));
        writeFileSync(client, readFileSync(client, 'utf8').replace('GrpcServices="Server"', 'GrpcServices="Both"'));
        check('Server -> Both relabels it without a reload', await until(async () => (await rowsNamed(tree, 'greet.proto (Both)')).length === 1, 40));
        cpSync(join(repo, 'src/__fixtures__/service-references/CardService/Connected Services/CardOperations'), join(ws.folder, 'Consumer/Connected Services/CardOperations'), { recursive: true });
        // Once the folder exists, the node is that folder: it shows collapsed that once (roadmap, Not Planned); open it
        const consumerConnected = async () => (await rowsNamed(tree, 'Connected Services'))[1]?.locator;
        const isOpen = async locator => locator.locator('.expand-icon').first().evaluate(e => !e.style.transform.includes('rotate(0deg)')).catch(() => false);
        const firstWcf = async () => (await below('Connected Services', 1))[0] === 'CardOperations';
        let wcf = false;
        for (let i = 0; i < 40 && !wcf; i++) {
            const node = await consumerConnected();
            if (node && !await isOpen(node)) { await node.locator('.expand-icon').first().click(); await win.waitForTimeout(1000); }
            wcf = await firstWcf();
            if (!wcf) await win.waitForTimeout(500);
        }
        check('with a WCF reference folder in Connected Services, it lists the WCF reference first, then the gRPC references', wcf && (await below('Connected Services', 1)).slice(1).join('|') === 'greet.proto (Client)|money.proto (None)|remote.proto (Client)', JSON.stringify(await below('Connected Services', 1)));
    });
});

// Add from a file
await part('add from a file', async () => {
    const ws = prepareFixture('grpc');
    await withWindow(ws, async ({ win, tree, until, below }) => {
        await expandPath(win, tree, ['Grpc', 'Client']);
        await settle(win, tree);
        await contextMenu(win, tree, 'Client', ['Add Service Reference...']);
        const kinds = await quickItems(win);
        check('Add Service Reference... offers WCF Web Service and gRPC', kinds.some(k => /^WCF Web Service/.test(k)) && kinds.some(k => /^gRPC/.test(k)), JSON.stringify(kinds));
        await pickQuick(win, /^WCF Web Service/);
        const wsdl = await quickItems(win);
        check('WCF goes on to the WSDL question', wsdl.some(k => /Browse for WSDL File/.test(k)), JSON.stringify(wsdl));
        await win.keyboard.press('Escape');
        await win.waitForTimeout(500);
        const services = await addGrpc(win, tree, 'Client', { file: join(ws.folder, 'shared/greet.proto') });
        check('What to generate? has Client preselected (first) for a console project', /^Client\b/.test(services[0] ?? ''), JSON.stringify(services));
        check('the reference is added', !!await waitForToast(win, /gRPC reference greet\.proto added \(Client\)/, 240), await toastsText(win));
        const xml = read(ws, 'Client/Client.csproj');
        check('Client.csproj gets the Protobuf item with Link="Protos\\greet.proto"', /<Protobuf Include="\.\.\\shared\\greet\.proto" GrpcServices="Client" Link="Protos\\greet\.proto" \/>/.test(xml), xml);
        check('and Google.Protobuf, Grpc.Net.ClientFactory and Grpc.Tools (with PrivateAssets)', /Include="Google\.Protobuf"/.test(xml) && /Include="Grpc\.Net\.ClientFactory"/.test(xml) && /Include="Grpc\.Tools"[\s\S]{0,200}PrivateAssets/.test(xml), xml);
        await clearToasts(win);
        check('the tree shows Connected Services > greet.proto (Client)', await until(async () => (await below('Client')).includes('Connected Services'), 30));
        await expandPath(win, tree, ['Connected Services', 'Protos']);
        await settle(win, tree);
        check('and Protos > greet.proto with the link badge', (await rowsNamed(tree, 'greet.proto (Client)')).length === 1 && await (await rowsNamed(tree, 'greet.proto'))[0]?.locator.locator('.link-overlay').count() === 1);
        const build = await sh(ws, 'dotnet build Client/Client.csproj -nologo');
        const generated = (dir => { const out = []; const walk = d => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (/Grpc\.cs$/.test(e)) out.push(f); } }; if (existsSync(dir)) walk(dir); return out; })(join(ws.folder, 'Client/obj'));
        check('dotnet build generates GreeterClient', generated.some(f => /GreeterClient/.test(readFileSync(f, 'utf8'))), build.slice(-400));
        await addGrpc(win, tree, 'Client', { file: join(ws.folder, 'shared/greet.proto') }, 'Client');
        check('adding the same file again says it is a reference already', !!await waitForToast(win, /already/i, 60), await toastsText(win));
        await clearToasts(win);
        await contextMenuOn(win, (await rowsNamed(tree, 'greet.proto (Client)'))[0].locator, ['Remove gRPC Reference']);
        const ask = await modal(win);
        check('Remove asks first', !!ask && /Remove the gRPC reference 'greet\.proto'/.test(ask.text), ask?.text);
        if (ask) await ask.press('Remove');
        check('removing the last reference takes Connected Services away', await until(async () => !(await below('Client')).includes('Connected Services') && !/<Protobuf/.test(read(ws, 'Client/Client.csproj')), 30), JSON.stringify(await below('Client')));
    });
});

// From a URL, failures, Central Package Management, offline packages
await part('add from a URL', async () => {
    const html = await startServer((req, res) => {
        if (req.url.startsWith('/slow')) { setTimeout(() => { res.end('syntax = "proto3";\n'); }, 60000); return; }
        res.setHeader('content-type', 'text/html');
        res.end('<!DOCTYPE html><html><body><form>Sign in</form></body></html>');
    });
    const ws = prepareFixture('grpc');
    const home = isolateHome(ws);
    try {
    await withWindow(ws, async ({ win, tree, until }) => {
        await expandPath(win, tree, ['Grpc', 'Web']);
        await settle(win, tree);
        const services = await addGrpc(win, tree, 'Web', { url: GITHUB_PROTO });
        check('in a web project Both is preselected', /^Both\b/.test(services[0] ?? ''), JSON.stringify(services));
        check('the reference is added', !!await waitForToast(win, /gRPC reference greet\.proto added \(Both\)/, 240), await toastsText(win));
        const xml = read(ws, 'Web/Web.csproj');
        check('Web/Protos/greet.proto is downloaded', existsSync(join(ws.folder, 'Web/Protos/greet.proto')) && /syntax/.test(read(ws, 'Web/Protos/greet.proto')));
        check('the item has <SourceUrl>', new RegExp(`<SourceUrl>${GITHUB_PROTO.replace(/[.]/g, '\\.')}</SourceUrl>`).test(xml), xml);
        check('only Grpc.AspNetCore is added', (xml.match(/<PackageReference /g) ?? []).length === 1 && /Include="Grpc\.AspNetCore"/.test(xml), xml);
        await clearToasts(win);
        const before = read(ws, 'Web/Web.csproj');
        const proto = read(ws, 'Web/Protos/greet.proto');

        await addGrpc(win, tree, 'Web', { url: 'http://127.0.0.1:9/missing.proto' }, 'Both');
        const failed = await waitForToast(win, /could not be downloaded/, 60);
        check('a download that fails says so and offers Show Output', !!failed && /Show Output/.test(await failed.innerText()), await toastsText(win));
        check('and the project is unchanged', read(ws, 'Web/Web.csproj') === before);
        await clearToasts(win);

        // A Protos/greet.proto on disk that is not a reference (Client): the HTML answer is refused and the file stays
        mkdirSync(join(ws.folder, 'Client/Protos'), { recursive: true });
        writeFileSync(join(ws.folder, 'Client/Protos/greet.proto'), 'syntax = "proto3";\n// mine\n');
        const clientBefore = read(ws, 'Client/Client.csproj');
        await expandPath(win, tree, ['Client']);
        await addGrpc(win, tree, 'Client', { url: `${html.url}/greet.proto` }, 'Client');
        check('an address that answers with an HTML page is refused', !!await waitForToast(win, /did not send a \.proto file/, 60), await toastsText(win));
        check('and the existing Protos/greet.proto stays, the project unchanged', read(ws, 'Client/Protos/greet.proto') === 'syntax = "proto3";\n// mine\n' && read(ws, 'Client/Client.csproj') === clientBefore);
        await clearToasts(win);

        await addGrpc(win, tree, 'Web', { url: `${html.url}/slow/other.proto` }, 'Both');
        const progress = await waitForToast(win, /Download/i, 20);
        const cancel = progress?.getByRole('button', { name: 'Cancel' });
        if (cancel && await cancel.count()) await cancel.click();
        await win.waitForTimeout(3000);
        check('Cancel on the download notification stops it without an error', !!progress && !(await win.locator('.notification-toast').allInnerTexts()).some(t => /could not|failed|error/i.test(t)) && !existsSync(join(ws.folder, 'Web/Protos/other.proto')), await toastsText(win));
        await clearToasts(win);

        // The package source cannot be reached: the item is written, the packages failed; again once reachable: only the packages
        const nugetConfig = join(home, '.nuget/NuGet/NuGet.Config');
        await sh(ws, 'dotnet nuget list source');
        const online = readFileSync(nugetConfig, 'utf8');
        writeFileSync(nugetConfig, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n    <add key="offline" value="http://127.0.0.1:9/v3/index.json" />\n  </packageSources>\n</configuration>\n');
        await runCommand(win, 'Developer: Reload Window').catch(() => {});
        await win.waitForTimeout(1000);
    });
    // After the reload the window is a new one: work in a fresh start with the offline source
    await withWindow(ws, async ({ win, tree, until }) => {
        await expandPath(win, tree, ['Grpc', 'Client']);
        await settle(win, tree);
        await addGrpc(win, tree, 'Client', { file: join(ws.folder, 'shared/greet.proto') }, 'Client');
        check('offline: the item is written and the message says the packages failed', !!await waitForToast(win, /added, but adding its packages failed/, 240) && /<Protobuf Include="\.\.\\shared\\greet\.proto"/.test(read(ws, 'Client/Client.csproj')) && !/Grpc\.Net\.ClientFactory/.test(read(ws, 'Client/Client.csproj')), await toastsText(win));
        await clearToasts(win);
        const nugetConfig = join(isolateHome(ws), '.nuget/NuGet/NuGet.Config');
        writeFileSync(nugetConfig, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n');
        await win.waitForTimeout(6000);
        await addGrpc(win, tree, 'Client', { file: join(ws.folder, 'shared/greet.proto') }, 'Client');
        check('online again, the same reference adds only its packages', !!await waitForToast(win, /its missing packages were added/, 240) && (read(ws, 'Client/Client.csproj').match(/<Protobuf /g) ?? []).length === 1 && /Grpc\.Net\.ClientFactory/.test(read(ws, 'Client/Client.csproj')), await toastsText(win) + read(ws, 'Client/Client.csproj'));
    });
    } finally { html.close(); }

    // Central Package Management
    const cpm = prepareFixture('grpc', {}, { 'Directory.Packages.props': '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n' });
    await withWindow(cpm, async ({ win, tree }) => {
        await expandPath(win, tree, ['Grpc', 'Web']);
        await settle(win, tree);
        await addGrpc(win, tree, 'Web', { url: GITHUB_PROTO }, 'Both');
        check('under Central Package Management the reference is added', !!await waitForToast(win, /gRPC reference greet\.proto added/, 240), await toastsText(win));
        check('the version goes to Directory.Packages.props', /<PackageVersion Include="Grpc\.AspNetCore" Version="[\d.]+"/.test(read(cpm, 'Directory.Packages.props')), read(cpm, 'Directory.Packages.props'));
        check('and Web gets a PackageReference without Version', /<PackageReference Include="Grpc\.AspNetCore" \/>/.test(read(cpm, 'Web/Web.csproj')), read(cpm, 'Web/Web.csproj'));
    });
});

// Update and Remove
await part('update and remove', async () => {
    const ws = prepareFixture('grpc');
    await withWindow(ws, async ({ win, tree, until, below }) => {
        await expandPath(win, tree, ['Grpc', 'Consumer', 'Connected Services']);
        await settle(win, tree);
        const menus = {};
        for (const name of ['greet.proto (Client)', 'money.proto (None)', 'remote.proto (Client)']) menus[name] = (await menuLabels(win, tree, name)).includes('Update gRPC Reference');
        check('Update gRPC Reference is only on remote.proto (added from a URL)', JSON.stringify(menus) === JSON.stringify({ 'greet.proto (Client)': false, 'money.proto (None)': false, 'remote.proto (Client)': true }), JSON.stringify(menus));
        const remote = join(ws.folder, 'Consumer/Protos/remote.proto');
        const before = readFileSync(remote, 'utf8');
        await contextMenu(win, tree, 'remote.proto (Client)', ['Update gRPC Reference']);
        const updated = await waitForToast(win, /remote\.proto updated from|remote\.proto is up to date/, 120);
        check('Update downloads the file again and says so', !!updated, await toastsText(win));
        console.log(`note: the fixture's remote.proto ${before === readFileSync(remote, 'utf8') ? 'was the same as GitHub\'s' : 'was replaced'}`);
        await clearToasts(win);
        const stamp = statSync(remote).mtimeMs;
        await contextMenu(win, tree, 'remote.proto (Client)', ['Update gRPC Reference']);
        check('a second Update says it is up to date', !!await waitForToast(win, /remote\.proto is up to date/, 120), await toastsText(win));
        check('and keeps the file\'s time stamp', statSync(remote).mtimeMs === stamp);
        await clearToasts(win);
        const project = read(ws, 'Consumer/Consumer.csproj');
        await contextMenu(win, tree, 'money.proto (None)', ['Remove gRPC Reference']);
        check('Remove on money.proto names the wildcard Contracts\\*.proto', !!await waitForToast(win, /Contracts\\\*\.proto/, 30), await toastsText(win));
        check('and changes nothing', read(ws, 'Consumer/Consumer.csproj') === project);
        await clearToasts(win);
        await contextMenu(win, tree, 'remote.proto (Client)', ['Remove gRPC Reference']);
        const ask = await modal(win);
        check('Remove on remote.proto asks', !!ask && /remote\.proto/.test(ask.text), ask?.text);
        if (ask) await ask.press('Remove');
        const expected = project.replace(/\s*<Protobuf Include="Protos\\remote\.proto" GrpcServices="Client">\s*<SourceUrl>[^<]*<\/SourceUrl>\s*<\/Protobuf>/, '');
        check('the whole <Protobuf> block with <SourceUrl> leaves Consumer.csproj, the rest as it was', await until(() => read(ws, 'Consumer/Consumer.csproj') === expected, 20), read(ws, 'Consumer/Consumer.csproj'));
        check('and remote.proto stays on disk', existsSync(remote));
    });
});

// An older Google.Protobuf
await part('older Google.Protobuf', async () => {
    const old = '<PackageReference Include="Google.Protobuf" Version="3.20.0" />';
    for (const answer of ['Raise', 'Cancel']) {
        const ws = prepareFixture('grpc', {}, {});
        writeFileSync(join(ws.folder, 'Web/Web.csproj'), read(ws, 'Web/Web.csproj').replace('</Project>', `  <ItemGroup>\n    ${old}\n  </ItemGroup>\n\n</Project>`));
        await withWindow(ws, async ({ win, tree }) => {
            await expandPath(win, tree, ['Grpc', 'Web']);
            await settle(win, tree);
            await addGrpc(win, tree, 'Web', { file: join(ws.folder, 'shared/greet.proto') }, 'Both');
            const ask = await modal(win, 120);
            check(`[${answer}] it asks to raise Google.Protobuf to the version Grpc.AspNetCore needs`, !!ask && /needs Google\.Protobuf [\d.]+ or newer; Web has 3\.20\.0/.test(ask.text), ask?.text);
            if (!ask) return;
            const raise = /Raise to ([\d.]+)/.exec(ask.text)?.[1];
            await ask.press(answer === 'Raise' ? `Raise to ${raise}` : 'Cancel');
            if (answer === 'Raise') {
                check('Raise: the reference is added', !!await waitForToast(win, /gRPC reference greet\.proto added \(Both\)/, 240), await toastsText(win));
                const xml = read(ws, 'Web/Web.csproj');
                check(`Raise sets Google.Protobuf ${raise} and adds Grpc.AspNetCore`, new RegExp(`Include="Google\\.Protobuf" Version="${raise}"`).test(xml) && /Include="Grpc\.AspNetCore"/.test(xml), xml);
                const build = await sh(ws, 'dotnet build Web/Web.csproj -nologo');
                check('dotnet build succeeds (no NU1605)', /Build succeeded/.test(build) && !/NU1605/.test(build), build.slice(-500));
            } else {
                check('Cancel adds only the <Protobuf> item and says to raise Google.Protobuf', !!await waitForToast(win, /not its packages|Raise Google\.Protobuf/, 60) && /<Protobuf /.test(read(ws, 'Web/Web.csproj')) && !/Grpc\.AspNetCore/.test(read(ws, 'Web/Web.csproj')), await toastsText(win));
            }
        });
    }
    // Central Package Management: the PackageVersion is raised; another project that uses it is asked about first
    const cpm = prepareFixture('grpc', {}, { 'Directory.Packages.props': '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageVersion Include="Google.Protobuf" Version="3.20.0" />\n  </ItemGroup>\n</Project>\n' });
    for (const p of ['Web/Web.csproj', 'Client/Client.csproj']) writeFileSync(join(cpm.folder, p), read(cpm, p).replace('</Project>', '  <ItemGroup>\n    <PackageReference Include="Google.Protobuf" />\n  </ItemGroup>\n\n</Project>'));
    await withWindow(cpm, async ({ win, tree }) => {
        await expandPath(win, tree, ['Grpc', 'Web']);
        await settle(win, tree);
        await addGrpc(win, tree, 'Web', { file: join(cpm.folder, 'shared/greet.proto') }, 'Both');
        const texts = [];
        for (let i = 0; i < 3; i++) {
            const ask = await modal(win, i === 0 ? 120 : 10);
            if (!ask) break;
            texts.push(ask.text);
            const buttons = (await win.locator('.monaco-dialog-box .monaco-button').allInnerTexts()).map(b => b.trim());
            console.log(`question ${i + 1}: ${ask.text} | buttons: ${buttons.join(' / ')}`);
            const button = buttons.find(b => /^Raise to /.test(b)) ?? buttons.find(b => b === 'Update All Projects') ?? buttons.find(b => !/Cancel/.test(b));
            await ask.press(button);
        }
        check('under Central Package Management it asks, naming the other project that uses Google.Protobuf (Client)', texts.some(t => /Client/.test(t)), JSON.stringify(texts));
        check('and raises the PackageVersion', !!await waitForToast(win, /gRPC reference greet\.proto added/, 240) && !/Google\.Protobuf" Version="3\.20\.0"/.test(read(cpm, 'Directory.Packages.props')), read(cpm, 'Directory.Packages.props'));
    });
});
