import { isCopyDrag, isMacPlatform } from '../../../../webview/shared/dragCopyKey';

describe('the copy key of a drag', () => {
    const keys = (keys: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) =>
        ({ ctrlKey: false, metaKey: false, altKey: false, ...keys });

    it('recognizes macOS by the platform or the user agent', () => {
        expect(isMacPlatform({ platform: 'MacIntel', userAgent: '' })).toBe(true);
        expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Code/1.95.0 Electron/32' })).toBe(true);
        expect(isMacPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Code/1.95.0' })).toBe(false);
        expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Code/1.95.0' })).toBe(false);
        // jsdom on a Mac says "darwin": that is not a browser on macOS
        expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/20.0.3' })).toBe(false);
        expect(isMacPlatform(undefined)).toBe(false);
    });

    it('Windows and Linux: only Ctrl copies', () => {
        expect(isCopyDrag(keys({ ctrlKey: true }), false)).toBe(true);
        expect(isCopyDrag(keys({ metaKey: true }), false)).toBe(false);
        expect(isCopyDrag(keys({ altKey: true }), false)).toBe(false);
        expect(isCopyDrag(keys({}), false)).toBe(false);
    });

    it('macOS: Ctrl, Cmd or Option copies (Option is the browsers\' own copy key)', () => {
        expect(isCopyDrag(keys({ ctrlKey: true }), true)).toBe(true);
        expect(isCopyDrag(keys({ metaKey: true }), true)).toBe(true);
        expect(isCopyDrag(keys({ altKey: true }), true)).toBe(true);
        expect(isCopyDrag(keys({}), true)).toBe(false);
    });
});
