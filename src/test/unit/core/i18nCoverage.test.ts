import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file: string): Record<string, string> => JSON.parse(read(file)) as Record<string, string>;

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) { return entry.name === '__fixtures__' ? [] : sourceFiles(relative); }
        return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [relative] : [];
    });
}

/** The first argument of every `t('...')` call that is a plain string, also the two of `t(cond ? 'a' : 'b')` */
function keysOf(files: string[]): { key: string; raw: string; file: string }[] {
    const literal = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
    const call = new RegExp(String.raw`(?<![\w.])t\(\s*(?:[^'"` + '`' + String.raw`()]*\?\s*)?(?:${literal})(?:\s*:\s*'((?:[^'\\\n]|\\.)*)')?`, 'g');
    const found: { key: string; raw: string; file: string }[] = [];
    for (const file of files) {
        for (const match of read(file).matchAll(call)) {
            for (const text of [match[1], match[2], match[3]]) {
                if (text !== undefined) { found.push({ key: text.replace(/\\(.)/g, (_escape, char: string) => char === 'n' ? '\n' : char), raw: text, file }); }
            }
        }
    }
    return found;
}

describe('translations (Simplified Chinese)', () => {
    test('every %key% of package.json is in both package.nls files', () => {
        const keys = new Set([...read('package.json').matchAll(/%([\w.-]+)%/g)].map(match => match[1]));
        for (const file of ['package.nls.json', 'package.nls.zh-cn.json']) {
            const nls = json(file);
            expect([...keys].filter(key => !(key in nls))).toEqual([]);
        }
    });

    test('every t() message of the extension host is in both l10n bundles', () => {
        const files = sourceFiles('src').filter(file => !file.startsWith(path.join('src', 'webview', 'solution-view')) && read(file).includes("core/i18n'"));
        const keys = keysOf(files);
        for (const file of ['l10n/bundle.l10n.json', 'l10n/bundle.l10n.zh-cn.json']) {
            const bundle = json(file);
            expect(keys.filter(({ key }) => !(key in bundle)).map(({ key, file: from }) => `${from}: ${key}`)).toEqual([]);
        }
    });

    test('every t() message of the webviews is in both l10n bundles (the extension hands its bundle to the page)', () => {
        const files = sourceFiles(path.join('src', 'webview')).filter(file => read(file).includes("shared/i18n'") && !file.endsWith(path.join('shared', 'i18n.ts')));
        const keys = keysOf(files);
        expect(keys.length).toBeGreaterThan(100);
        for (const file of ['l10n/bundle.l10n.json', 'l10n/bundle.l10n.zh-cn.json']) {
            const bundle = json(file);
            expect(keys.filter(({ key }) => !(key in bundle)).map(({ key, file: from }) => `${from}: ${key}`)).toEqual([]);
        }
    });
});
