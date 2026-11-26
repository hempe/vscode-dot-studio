import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordPendingOpen, takePendingOpen } from '../../../../services/solution/pendingOpen';

const memento = () => {
    const data = new Map<string, unknown>();
    return { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value); } };
};

describe('the file to open after the window reopens on its folder', () => {
    it('is taken once, for that folder only', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'));
        const file = path.join(dir, 'App.csproj');
        fs.writeFileSync(file, '<Project />');
        const state = memento();
        await recordPendingOpen(state, dir, file);
        expect(await takePendingOpen(state, path.join(dir, 'other'))).toBeUndefined();
        expect(await takePendingOpen(state, dir)).toBe(file);
        expect(await takePendingOpen(state, dir)).toBeUndefined();
    });

    it('is dropped when the file is gone', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'));
        const state = memento();
        await recordPendingOpen(state, dir, path.join(dir, 'Gone.sln'));
        expect(await takePendingOpen(state, dir)).toBeUndefined();
    });
});
