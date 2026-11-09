// Checks that the C# extension's real language server loads Shinobi.Refactorings.dll and answers its handlers.
//
//   npm run build:server-extension && npm run check:server-extension
//
// The xunit project (npm run test:server-extension) tests the logic in an in-memory workspace; this tests the way in: the server
// started the way the C# extension starts it (--extension <dll>), the extension activated with `server/_vs_activateExtension`, and every
// refactoring's handler asked with `textDocument/_vs_dispatchExtensionMessage` (`_vs_dipatchExtensionMessage` up to Roslyn 5.12) on a small solution. It is what breaks when a new version of
// the C# extension binds another Roslyn or changes the extension API (the refactorings would silently be gone from Ctrl+.).
// Skipped (exit 0) when no C# extension with a server is installed; ROSLYN_SERVER names the server's executable, DLL the assembly.
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// Both builds, as the extension has them: the one for Roslyn 5.13 and later first (DLL names a single one)
const dlls = process.env.DLL ? [process.env.DLL] : [
  path.join(repo, 'out', 'server-extension', 'roslyn-5.13', 'Shinobi.Refactorings.dll'),
  path.join(repo, 'out', 'server-extension', 'Shinobi.Refactorings.dll'),
];
const exe = process.platform === 'win32' ? '.exe' : '';

function findServer() {
  if (process.env.ROSLYN_SERVER) return process.env.ROSLYN_SERVER;
  const found = [];
  for (const dir of fs.readdirSync(os.homedir(), { withFileTypes: true }).filter(d => /^\.vscode/.test(d.name))) {
    const extensions = path.join(os.homedir(), dir.name, 'extensions');
    if (!fs.existsSync(extensions)) continue;
    for (const name of fs.readdirSync(extensions)) {
      if (!/^(muhammad-sammy|ms-dotnettools)\.csharp-/.test(name)) continue;
      const candidate = path.join(extensions, name, '.roslyn', 'Microsoft.CodeAnalysis.LanguageServer' + exe);
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  return found.sort().at(-1);
}

const server = findServer();
if (!server) {
  console.log('skipped: no C# extension with a language server is installed (set ROSLYN_SERVER to its Microsoft.CodeAnalysis.LanguageServer)');
  process.exit(0);
}
for (const dll of dlls.filter(d => !fs.existsSync(d))) {
  console.error(`${dll} is missing: run npm run build:server-extension`);
  process.exit(1);
}

// The Roslyn the server binds, from its deps file
try {
  const deps = JSON.parse(fs.readFileSync(path.join(path.dirname(server), 'Microsoft.CodeAnalysis.LanguageServer.deps.json'), 'utf8'));
  const roslyn = Object.keys(deps.libraries ?? {}).find(name => name.startsWith('Microsoft.CodeAnalysis.Common/'));
  console.log(`server: ${server}\nRoslyn it binds: ${roslyn?.split('/')[1] ?? 'unknown'} (our dlls are compiled against 5.0 and 5.13, see server-extension/)`);
} catch {
  console.log(`server: ${server}`);
}

// ---- a small solution
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-lsp-'));
fs.mkdirSync(path.join(root, 'Lib'));
fs.writeFileSync(path.join(root, 'Fixture.slnx'), '<Solution>\n  <Project Path="Lib/Lib.csproj" />\n</Solution>\n');
fs.writeFileSync(path.join(root, 'Lib', 'Lib.csproj'), '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>disable</Nullable>\n  </PropertyGroup>\n</Project>\n');
const source = `namespace Fixture;

public interface IScale { double Scale(double factor, string unit); }

public class Order : IScale
{
    private readonly List<int> _lines = new();

    public int Total => _lines.Sum();

    public void Add(int line) => _lines.Add(line);

    public double Scale(double factor, string unit) => factor;

    public double Twice() => Scale(2, "m");
}

public abstract class Base { public abstract void Run(); }

public class Derived : Base { public override void Run() { } }
`;
const file = path.join(root, 'Lib', 'Order.cs');
fs.writeFileSync(file, source);
execFileSync('dotnet', ['restore', path.join(root, 'Fixture.slnx'), '--nologo', '-v', 'q'], { stdio: 'inherit' });

// ---- the server, started the way the C# extension starts it
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-lsp-logs-'));
const child = spawn(server, ['--stdio', '--logLevel', 'Information', '--extensionLogDirectory', logDir, '--autoLoadProjects', ...dlls.flatMap(dll => ['--extension', dll])], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
const notifications = new Set();
const serverLog = [];
child.stderr.on('data', d => serverLog.push(d.toString()));
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.id !== undefined && message.method) {
      send({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? (message.params.items ?? []).map(() => null) : null });
    } else if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method) {
      notifications.add(message.method);
    }
  }
});
const send = m => { const body = JSON.stringify(m); child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); };
const request = (method, params, timeout = 120000) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error('timeout: ' + method)), timeout);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
  send({ jsonrpc: '2.0', id, method, params });
});
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + detail}`);
  if (!ok) failures.push(name);
};

const finish = code => {
  child.kill();
  try { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* the server may still hold a file */ }
  process.exit(code);
};

try {
  const rootUri = pathToFileURL(root).href;
  await request('initialize', { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: 'Fixture' }], capabilities: { workspace: { configuration: true, workspaceFolders: true } } });
  notify('initialized', {});
  notify('solution/open', { solution: pathToFileURL(path.join(root, 'Fixture.slnx')).href });
  for (let i = 0; i < 180 && !notifications.has('workspace/projectInitializationComplete'); i++) await sleep(1000);
  check('the server loaded the project', notifications.has('workspace/projectInitializationComplete'));

  const uri = pathToFileURL(file).href;
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'csharp', version: 1, text: source } });
  await sleep(3000);

  // like the C# extension does for us (an "already registered" answer is fine: --extension registered it)
  const activated = [];
  for (const dll of dlls) {
    try {
      await request('server/_vs_activateExtension', { assemblyFilePath: dll });
      activated.push(dll);
    } catch (error) {
      if (/already registered/i.test(error.message)) activated.push(dll);
      else console.log(`(${path.relative(repo, dll)} not activated: ${error.message})`);
    }
  }
  check('the extension is activated', activated.length > 0, 'neither assembly');

  const lines = source.split('\n');
  const at = (text, name = text) => {
    const line = lines.findIndex(l => l.includes(text));
    return { line, character: lines[line].indexOf(name) };
  };
  // The name the extension tries first, then the old spelling, as src/services/refactoring/csharpServer.ts does
  // and the first assembly whose handlers the server knows
  let dispatchMethod = 'textDocument/_vs_dispatchExtensionMessage';
  let assembly = 0;
  const send = async (handler, message) => {
    const params = { textDocument: { uri }, messageName: `Shinobi.Refactorings.${handler}`, assemblyFilePath: dlls[assembly], message: JSON.stringify(message) };
    try {
      return await request(dispatchMethod, params);
    } catch (error) {
      if (!/No method by the name/i.test(error.message)) throw error;
      dispatchMethod = dispatchMethod.includes('dispatch') ? 'textDocument/_vs_dipatchExtensionMessage' : 'textDocument/_vs_dispatchExtensionMessage';
      console.log(`(the server knows ${dispatchMethod})`);
      return request(dispatchMethod, params);
    }
  };
  const ask = async (handler, message) => {
    let reply;
    for (;;) {
      try {
        reply = await send(handler, message);
        break;
      } catch (error) {
        if (!/No handler found/i.test(error.message) || assembly + 1 >= dlls.length) throw error;
        assembly++;
        console.log(`(the server has no handlers in the first assembly, using ${path.relative(repo, dlls[assembly])})`);
      }
    }
    return reply?.response ? JSON.parse(reply.response) : undefined;
  };
  const probe = async (handler, position, ok) => {
    try {
      const info = await ask(handler, { position });
      check(handler, !!info && ok(info), JSON.stringify(info)?.slice(0, 200) ?? 'no answer');
      return info;
    } catch (error) {
      check(handler, false, error.message);
    }
  };

  const order = at('public class Order', 'Order');
  const interfaceInfo = await probe('ExtractInterfaceInfoHandler', order, i => i.members.some(m => m.signature.includes('Total')));
  await probe('ExtractPartialInfoHandler', order, i => i.members.length > 0);
  await probe('ExtractSuperclassInfoHandler', order, i => i.members.length > 0);
  await probe('ExtractClassInfoHandler', order, i => i.members.length > 0);
  await probe('MoveTypeNamespaceInfoHandler', order, i => i.typeName === 'Order');
  await probe('UseBaseTypeInfoHandler', order, i => i.typeName === 'Order');
  await probe('PullUpInfoHandler', at('public class Derived', 'Derived'), i => i.targets.length > 0);
  await probe('PushDownInfoHandler', at('public abstract class Base', 'Base'), i => i.derived.length > 0);
  await probe('ConvertTypeInfoHandler', at('public abstract class Base', 'Base'), i => i.direction === 'toInterface');
  await probe('ChangeSignatureInfoHandler', at('public double Scale', 'Scale'), i => i.parameters.length === 2);

  // two complete runs: the edits come back, compiled and without errors
  try {
    const result = await ask('ChangeSignatureHandler', {
      position: at('public double Scale', 'Scale'),
      parameters: [{ oldIndex: 1, name: 'unit', type: 'string' }, { oldIndex: 0, name: 'factor', type: 'double' }],
    });
    check('ChangeSignatureHandler changes the declarations and the call', !result?.errors && /Scale\(string unit, double factor\)/.test(JSON.stringify(result?.edits)) && JSON.stringify(result?.edits).includes('Scale(\\"m\\", 2)'), JSON.stringify(result)?.slice(0, 300));
  } catch (error) {
    check('ChangeSignatureHandler changes the declarations and the call', false, error.message);
  }
  try {
    const total = interfaceInfo?.members.find(m => m.signature.includes('Total'));
    const result = await ask('ExtractInterfaceHandler', { position: order, interfaceName: 'IOrder', memberIds: [total.id], newFile: true });
    check('ExtractInterfaceHandler writes the interface', !result?.errors && /interface IOrder/.test(result?.newFileContent ?? ''), JSON.stringify(result)?.slice(0, 300));
  } catch (error) {
    check('ExtractInterfaceHandler writes the interface', false, error.message);
  }
} catch (error) {
  check('the check ran', false, error.message);
  console.error(serverLog.join('').split('\n').slice(-15).join('\n'));
}

console.log(failures.length === 0 ? '\nall good' : `\n${failures.length} check(s) failed`);
finish(failures.length === 0 ? 0 : 1);
