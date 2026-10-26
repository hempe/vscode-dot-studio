// PersistentCache: file names do not reveal the key, keys do not collide, old entries are not served (review A4-1, A4-3, A4-5, A4-6)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistentCache } from '../../../core/persistentCache';

describe('PersistentCache', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-cache-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const newCache = (options = {}) => new PersistentCache<string>(path.join(dir, 'cache'), options);

    it('stores and returns an entry', async () => {
        const cache = newCache();
        await cache.set('https://feed/v3/index.json|', 'data', 'https://feed/v3/index.json');
        expect((await cache.get('https://feed/v3/index.json|'))?.data).toBe('data');
        expect(await cache.get('https://other')).toBeNull();
    });

    it('keeps the key, and so the token in it, out of the file names', async () => {
        const cache = newCache();
        const key = 'https://feed/v3/index.json|dG9rZW46U0VDUkVUUEFU';
        await cache.set(key, 'data', 'https://feed/v3/index.json');
        const files = fs.readdirSync(path.join(dir, 'cache'));
        expect(files).toHaveLength(1);
        expect(files[0]).not.toContain('SECRET');
        expect(files[0]).not.toContain('dG9rZW46');
        expect(files[0]).not.toContain('feed');
    });

    it('does not mix up keys that differ only in characters a file name cannot hold', async () => {
        const cache = newCache();
        await cache.set('q=foo bar', 'first', 'u');
        await cache.set('q=foo_bar', 'second', 'u');
        expect((await cache.get('q=foo bar'))?.data).toBe('first');
        expect((await cache.get('q=foo_bar'))?.data).toBe('second');
    });

    it('caches a very long key', async () => {
        const cache = newCache();
        const key = `https://pkgs.dev.azure.com/${'x'.repeat(300)}|${'t'.repeat(100)}`;
        await cache.set(key, 'data', 'u');
        expect((await cache.get(key))?.data).toBe('data');
    });

    it('does not return an entry older than maxAge', async () => {
        const cache = newCache({ maxAge: 1000 });
        await cache.set('k', 'data', 'u');
        const file = path.join(dir, 'cache', fs.readdirSync(path.join(dir, 'cache'))[0]);
        const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
        entry.timestamp = Date.now() - 5000;
        fs.writeFileSync(file, JSON.stringify(entry));
        expect(await cache.get('k')).toBeNull();
    });

    it('ignores a file that is not valid or not an entry', async () => {
        const cache = newCache();
        await cache.set('k', 'data', 'u');
        const file = path.join(dir, 'cache', fs.readdirSync(path.join(dir, 'cache'))[0]);
        fs.writeFileSync(file, '{"data": "planted"}');
        expect(await cache.get('k')).toBeNull();
        fs.writeFileSync(file, 'not json');
        expect(await cache.get('k')).toBeNull();
    });

    (process.platform === 'win32' ? it.skip : it)('is readable by the owner only', async () => {
        const cache = newCache();
        await cache.set('k', 'data', 'u');
        const folder = path.join(dir, 'cache');
        expect(fs.statSync(folder).mode & 0o077).toBe(0);
        expect(fs.statSync(path.join(folder, fs.readdirSync(folder)[0])).mode & 0o077).toBe(0);
    });

    it('removes the oldest entries beyond maxEntries', async () => {
        const cache = newCache({ maxEntries: 3 });
        for (let i = 0; i < 5; i++) {
            await cache.set(`k${i}`, `d${i}`, 'u');
        }
        expect(fs.readdirSync(path.join(dir, 'cache'))).toHaveLength(3);
    });
});
