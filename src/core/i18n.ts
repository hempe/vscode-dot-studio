type L10nApi = { t(message: string, ...args: Array<string | number | boolean>): string; bundle?: Record<string, string> };
type VscodeApi = { l10n?: L10nApi; env?: { language?: string } };

/**
 * The `vscode` module, loaded lazily: unit tests of modules that show messages do not provide it,
 * and their messages then stay in English.
 */
function api(): VscodeApi | undefined {
    try {
        return require('vscode') as VscodeApi;
    } catch {
        return undefined;
    }
}

/**
 * Translates a user-facing message with the extension's language bundle (`l10n/bundle.l10n.*.json`).
 * The English message is the key; `{0}`, `{1}`, ... are replaced by the arguments.
 */
export function t(message: string, ...args: Array<unknown>): string {
    // Template placeholders stringify like the template literals this replaces
    const values = args.map(arg => String(arg));
    const l10n = api()?.l10n;
    if (l10n?.t) {
        return l10n.t(message, ...values);
    }
    return message.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
        values[Number(index)] === undefined ? placeholder : values[Number(index)]);
}

/** The language VS Code runs in (`zh-cn` when its display language is Chinese), used by the webviews */
export function webviewLanguage(): string {
    return api()?.env?.language ?? 'en';
}

/**
 * The translations for a webview page: the extension's bundle of VS Code's language (undefined in English) as a JSON data block,
 * which `webview/shared/i18n.ts` reads. A data block is not run, so the page's script policy does not apply; `<` is escaped so the
 * text cannot end the element.
 */
export function webviewL10n(): string {
    const bundle = api()?.l10n?.bundle;
    if (!bundle) {
        return '';
    }
    return `<script type="application/json" id="shinobi-l10n">${JSON.stringify(bundle).replace(/</g, '\\u003c')}</script>`;
}
