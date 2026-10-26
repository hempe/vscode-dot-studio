// A folder in the shared temp folder that only this user uses (review A5-3)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { privateTempDir, writableByOthers } from '../../../core/privateTemp';

(process.platform === 'win32' ? describe.skip : describe)('privateTempDir', () => {
    it('creates a folder of this user, mode 700, below a user-named root', () => {
        const dir = privateTempDir('test-' + process.pid);
        try {
            expect(dir.startsWith(path.join(os.tmpdir(), `shinobi-dotnet-${os.userInfo().username}`))).toBe(true);
            expect(fs.statSync(dir).mode & 0o077).toBe(0);
            expect(writableByOthers(dir)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('sees a folder others can write to', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-wo-'));
        try {
            fs.chmodSync(dir, 0o777);
            expect(writableByOthers(dir)).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
