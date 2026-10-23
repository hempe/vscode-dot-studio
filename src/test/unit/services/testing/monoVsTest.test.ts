import * as path from 'path';
import { MONO_VSTEST_PACKAGE, MONO_VSTEST_VERSION, MonoVsTestDeps, needsMono, resolveMonoVsTestConsole } from '../../../../services/testing/monoVsTest';

const packages = path.join('/home/me/.nuget/packages');
const tools = path.join(packages, MONO_VSTEST_PACKAGE.toLowerCase(), MONO_VSTEST_VERSION, 'tools', 'net462');
const packageConsole = path.join(tools, 'vstest.console.exe');
/** The runnable copy the fake layout makes */
const consolePath = path.join('/tmp/layout', 'vstest.console.exe');

function deps(overrides: Partial<MonoVsTestDeps> = {}): MonoVsTestDeps & { downloads: number } {
    const result: MonoVsTestDeps & { downloads: number } = {
        downloads: 0,
        hasMono: async () => true,
        globalPackagesFolder: async () => packages,
        exists: (file: string) => file === packageConsole && result.downloads > 0,
        download: async () => { result.downloads++; return { ok: true, output: '' }; },
        layout: (from: string) => { expect(from).toBe(tools); return consolePath; },
        ...overrides,
    };
    return result;
}

describe('.NET Framework tests under Mono', () => {
    it('are needed for VSTest projects on .NET Framework outside Windows', () => {
        const project = { projectPath: '/r/T.csproj', targetPath: '/r/T.dll', testingPlatform: false, netFramework: true };
        expect(needsMono(project, 'linux')).toBe(true);
        expect(needsMono(project, 'darwin')).toBe(true);
        expect(needsMono(project, 'win32')).toBe(false);
        expect(needsMono({ ...project, netFramework: undefined }, 'linux')).toBe(false);
        expect(needsMono({ ...project, testingPlatform: true }, 'linux')).toBe(false);
    });

    it('use a copy of vstest.console.exe from the global packages folder', async () => {
        const fake = deps({ exists: file => file === packageConsole });
        await expect(resolveMonoVsTestConsole(fake)).resolves.toBe(consolePath);
        expect(fake.downloads).toBe(0);
    });

    it('download it once when it is missing', async () => {
        const fake = deps();
        await expect(resolveMonoVsTestConsole(fake)).resolves.toBe(consolePath);
        expect(fake.downloads).toBe(1);
    });

    it('say why they cannot run when Mono is missing', async () => {
        await expect(resolveMonoVsTestConsole(deps({ hasMono: async () => false }))).rejects.toThrow(
            /\.NET Framework test projects need Mono outside Windows[\s\S]*Could not find 'mono' host[\s\S]*Install Mono/);
    });

    it('say why they cannot run when the copy of vstest.console.exe fails', async () => {
        await expect(resolveMonoVsTestConsole(deps({ layout: () => { throw new Error('ENOSPC: no space left on device'); } }))).rejects.toThrow(
            'Could not prepare vstest.console.exe for Mono: ENOSPC: no space left on device');
    });

    it('say why they cannot run when the download fails', async () => {
        await expect(resolveMonoVsTestConsole(deps({ download: async () => ({ ok: false, output: 'error NU1101: Unable to find package' }) }))).rejects.toThrow(
            `Could not download ${MONO_VSTEST_PACKAGE} ${MONO_VSTEST_VERSION} (vstest.console.exe for Mono): error NU1101: Unable to find package`);
    });
});
