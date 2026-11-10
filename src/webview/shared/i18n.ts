/**
 * Localization of the webviews. The English text is the key, as in the extension host: the translations are the extension's own
 * bundle (`l10n/bundle.l10n.<language>.json`), which the extension host puts into the page as JSON (`webviewL10n()` in
 * `core/i18n.ts`, read here from `<script id="shinobi-l10n">`); without it (English, tests) the English text is shown.
 */

const format = (text: string, args: Array<string | number>): string =>
    text.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
        const value = args[Number(index)];
        return value === undefined ? placeholder : String(value);
    });

let bundle: Record<string, string> | undefined;

function translations(): Record<string, string> {
    if (!bundle) {
        const json = typeof document !== 'undefined' ? document.getElementById('shinobi-l10n')?.textContent : undefined;
        try {
            bundle = json ? JSON.parse(json) as Record<string, string> : {};
        } catch {
            bundle = {};
        }
    }
    return bundle;
}

/** Forgets the translations read from the page (tests that change it) */
export function resetTranslations(): void {
    bundle = undefined;
}

/**
 * Translates a user-visible message. The English message is the key; `{0}`, `{1}`, ... are replaced by the arguments.
 * A count is two keys, `t(n === 1 ? '{0} error' : '{0} errors', n)`, so each language words its own plural.
 */
export function t(message: string, ...args: Array<string | number>): string {
    return format(translations()[message] ?? message, args);
}
