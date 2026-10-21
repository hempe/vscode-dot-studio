/**
 * The key that turns a drag in the Solution Explorer into a copy. Windows and Linux: Ctrl, as in Visual Studio.
 * macOS: Ctrl, Cmd or Option (Option is the browsers' own copy key in a drag). Browser-safe: the webview runs in a
 * browser, so the platform comes from `navigator`, not from `process.platform`.
 */

type PlatformInfo = Pick<Navigator, 'platform' | 'userAgent'>;

export function isMacPlatform(nav: PlatformInfo | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
    if (!nav) {
        return false;
    }
    return /^(Mac|iPhone|iPad)/i.test(nav.platform ?? '') || /Macintosh|Mac OS X/.test(nav.userAgent ?? '');
}

export interface DragKeys {
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
}

export function isCopyDrag(keys: DragKeys, mac: boolean = isMacPlatform()): boolean {
    return keys.ctrlKey || (mac && (keys.metaKey || keys.altKey));
}
