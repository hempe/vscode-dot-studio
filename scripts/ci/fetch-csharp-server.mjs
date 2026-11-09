// Downloads the latest C# extension and unpacks its Roslyn language server, for the nightly check of the refactorings
// (.github/workflows/csharp-server.yml); prints the server's path for ROSLYN_SERVER.
//
//   node scripts/ci/fetch-csharp-server.mjs <ms-stable|ms-prerelease|fork> [target platform, default linux-x64] [folder]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [variant, platform = 'linux-x64', folder = fs.mkdtempSync(path.join(os.tmpdir(), `csharp-${variant}-`))] = process.argv.slice(2);

/** The VSIX of the newest version of ms-dotnettools.csharp for the platform, stable or pre-release, from the Visual Studio Marketplace */
async function microsoft(prerelease) {
    const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
        // IncludeVersions | IncludeFiles | IncludeVersionProperties | IncludeAssetUri
        body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: 'ms-dotnettools.csharp' }] }], flags: 0x1 | 0x2 | 0x10 | 0x80 }),
    });
    const versions = (await response.json()).results[0].extensions[0].versions;
    const isPrerelease = v => (v.properties ?? []).some(p => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true');
    const version = versions.find(v => v.targetPlatform === platform && isPrerelease(v) === prerelease);
    if (!version) throw new Error(`no ${prerelease ? 'pre-release' : 'stable'} version for ${platform}`);
    return { version: version.version, url: version.files.find(f => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage').source };
}

/** The VSIX of the newest muhammad-sammy.csharp for the platform, from Open VSX */
async function fork() {
    const latest = await (await fetch(`https://open-vsx.org/api/muhammad-sammy/csharp/${platform}/latest`)).json();
    return { version: latest.version, url: latest.files.download };
}

const { version, url } = variant === 'fork' ? await fork() : await microsoft(variant === 'ms-prerelease');
console.error(`${variant}: ${version}`);
const vsix = path.join(folder, 'extension.vsix');
fs.writeFileSync(vsix, Buffer.from(await (await fetch(url)).arrayBuffer()));
execFileSync('unzip', ['-q', '-o', vsix, 'extension/.roslyn/*', '-d', folder]);
const server = path.join(folder, 'extension', '.roslyn', `Microsoft.CodeAnalysis.LanguageServer${platform.startsWith('win32') ? '.exe' : ''}`);
fs.chmodSync(server, 0o755);
console.log(server);
