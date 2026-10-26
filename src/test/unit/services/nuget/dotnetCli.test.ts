// execDotnet passes arguments without a shell (review A4-2)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { execDotnet } from '../../../../services/nuget/dotnetCli';

const hasDotnet = (() => { try { execFileSync('dotnet', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const real = hasDotnet ? it : it.skip;

describe('execDotnet', () => {
    real('returns the output of the command', async () => {
        const { stdout } = await execDotnet(['--version']);
        expect(stdout.trim()).toMatch(/^\d+\.\d+/);
    });

    real('does not run shell syntax in an argument', async () => {
        const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-exec-')));
        try {
            const marker = path.join(dir, 'injected');
            // Through a shell, `;touch marker` would run as a second command
            await expect(execDotnet(['list', path.join(dir, `x.csproj;touch ${marker}`), 'package'])).rejects.toBeDefined();
            expect(fs.existsSync(marker)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    real('rejects when the command fails', async () => {
        await expect(execDotnet(['definitely-not-a-command'])).rejects.toBeDefined();
    });
});
