import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { legacyConfigPath } from './legacyNugetConfig';
import { xmlAttribute } from './configXml';

/** Credentials of a package source as NuGet would use them, and where they are */
export type SourceCredential =
    | { readonly kind: 'clearText'; readonly file: string; readonly line: number; readonly username?: string; readonly password: string }
    /** `Password`: encrypted with Windows DPAPI, unusable here */
    | { readonly kind: 'encrypted'; readonly file: string; readonly line: number; readonly username?: string }
    | { readonly kind: 'none' };

const findConfig = (dir: string) => {
    try {
        const name = fs.readdirSync(dir).find(entry => entry.toLowerCase() === 'nuget.config');
        return name ? path.join(dir, name) : undefined;
    } catch {
        return undefined;
    }
};

/** Where NuGet keeps the user config: %AppData%\NuGet on Windows, ~/.nuget/NuGet elsewhere */
export function userConfigDir(home = os.homedir()): string {
    return process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'NuGet')
        : path.join(home, '.nuget', 'NuGet');
}

/** The NuGet.Config files NuGet reads for `startDir`, closest first: every folder up to the root, then the user config */
export function nugetConfigFiles(startDir: string, home = os.homedir()): string[] {
    const files: string[] = [];
    for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
        const file = findConfig(dir);
        if (file) {
            files.push(file);
        }
        // Visual Studio's solution-level .nuget/NuGet.Config, read next to the solution (dotnet restore does not read it)
        if (dir === path.resolve(startDir)) {
            const legacy = legacyConfigPath(dir);
            if (legacy) {
                files.push(legacy);
            }
        }
        if (path.dirname(dir) === dir) {
            break;
        }
    }
    const user = findConfig(userConfigDir(home));
    if (user && !files.includes(user)) {
        files.push(user);
    }
    return files;
}

/** A source name as an XML element name, like .NET's XmlConvert.EncodeLocalName (`My Feed` → `My_x0020_Feed`) */
export function encodeSourceName(name: string): string {
    return [...name].map((char, index) => {
        const valid = index === 0 ? /[A-Za-z_]/.test(char) : /[A-Za-z0-9._-]/.test(char);
        return valid ? char : `_x${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}_`;
    }).join('');
}

/** The text with every comment replaced by spaces (line breaks stay), so offsets and line numbers still fit the file */
const withoutComments = (content: string) => content.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));

/** The credentials for `sourceName` in the first file that has any, as NuGet takes them */
export function findCredential(files: { path: string; content: string }[], sourceName: string): SourceCredential {
    const element = encodeSourceName(sourceName).replace(/[.]/g, '\\.');
    for (const file of files) {
        const content = withoutComments(file.content);
        const section = /<packageSourceCredentials\b[^>]*>([\s\S]*?)<\/packageSourceCredentials>/i.exec(content);
        if (!section) {
            continue;
        }
        const sectionStart = section.index + section[0].indexOf(section[1]);
        const block = new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}\\s*>`, 'i').exec(section[1]);
        if (!block) {
            continue;
        }
        const blockStart = sectionStart + block.index + block[0].indexOf(block[1]);
        let username: string | undefined;
        let password: { kind: 'clearText' | 'encrypted'; value: string; offset: number } | undefined;
        for (const add of block[1].matchAll(/<add\b[^>]*>/gi)) {
            const key = xmlAttribute(add[0], 'key')?.toLowerCase();
            const value = xmlAttribute(add[0], 'value') ?? '';
            if (key === 'username') {
                username = value;
            } else if (key === 'cleartextpassword') {
                password = { kind: 'clearText', value, offset: blockStart + add.index! };
            } else if (key === 'password' && password?.kind !== 'clearText') {
                password = { kind: 'encrypted', value, offset: blockStart + add.index! };
            }
        }
        if (!password) {
            continue;
        }
        const line = content.slice(0, password.offset).split('\n').length;
        return password.kind === 'clearText'
            ? { kind: 'clearText', file: file.path, line, ...(username !== undefined ? { username } : {}), password: password.value }
            : { kind: 'encrypted', file: file.path, line, ...(username !== undefined ? { username } : {}) };
    }
    return { kind: 'none' };
}

/** The credentials NuGet would use for the source, reading the configs fresh (a renewed token counts right away) */
export function readSourceCredential(sourceName: string, startDir: string): SourceCredential {
    const files = nugetConfigFiles(startDir).flatMap(file => {
        try {
            return [{ path: file, content: fs.readFileSync(file, 'utf8') }];
        } catch {
            return [];
        }
    });
    return findCredential(files, sourceName);
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Stores `token` as the ClearTextPassword of the source: replaces existing credentials in place (an encrypted
 * Password becomes a ClearTextPassword) or adds them, with the packageSourceCredentials section if needed
 */
export function setClearTextPassword(content: string, sourceName: string, username: string, token: string): string {
    const element = encodeSourceName(sourceName);
    const nl = content.includes('\r\n') ? '\r\n' : '\n';
    const add = (key: string, value: string) => `<add key="${key}" value="${escapeXml(value)}" />`;

    const block = new RegExp(`(<${element.replace(/[.]/g, '\\.')}\\b[^>]*>)([\\s\\S]*?)(</${element.replace(/[.]/g, '\\.')}\\s*>)`, 'i').exec(content);
    const inSection = block && /<packageSourceCredentials\b/i.test(content.slice(0, block.index))
        && /<\/packageSourceCredentials>/i.test(content.slice(block.index));
    if (block && inSection) {
        let inner = block[2];
        const existing = /<add\b[^>]*\bkey\s*=\s*"(ClearTextPassword|Password)"[^>]*>/gi;
        const replaced = inner.replace(existing, () => add('ClearTextPassword', token));
        // Keep a single password entry
        let seen = false;
        inner = replaced.replace(/[ \t]*<add\b[^>]*\bkey\s*=\s*"ClearTextPassword"[^>]*>\r?\n?/gi, match => {
            if (seen) {
                return '';
            }
            seen = true;
            return match;
        });
        if (!seen) {
            const indent = /\n([ \t]*)<add\b/.exec(inner)?.[1] ?? '      ';
            inner = `${inner.replace(/\s*$/, '')}${nl}${indent}${add('ClearTextPassword', token)}${nl}${/\n([ \t]*)$/.exec(block[2])?.[1] ?? '    '}`;
        }
        if (!/\bkey\s*=\s*"Username"/i.test(inner)) {
            const indent = /\n([ \t]*)<add\b/.exec(inner)?.[1] ?? '      ';
            inner = inner.replace(/(<add\b)/i, `${add('Username', username)}${nl}${indent}$1`);
        }
        return content.slice(0, block.index) + block[1] + inner + block[3] + content.slice(block.index + block[0].length);
    }

    const credentials = [
        `    <${element}>`,
        `      ${add('Username', username)}`,
        `      ${add('ClearTextPassword', token)}`,
        `    </${element}>`,
    ].join(nl);
    const sectionEnd = /([ \t]*)<\/packageSourceCredentials>/i.exec(content);
    if (sectionEnd) {
        return content.slice(0, sectionEnd.index) + credentials + nl + content.slice(sectionEnd.index);
    }
    const configurationEnd = content.lastIndexOf('</configuration>');
    const section = `  <packageSourceCredentials>${nl}${credentials}${nl}  </packageSourceCredentials>${nl}`;
    return configurationEnd >= 0
        ? content.slice(0, configurationEnd) + section + content.slice(configurationEnd)
        : `<?xml version="1.0" encoding="utf-8"?>${nl}<configuration>${nl}${section}</configuration>${nl}`;
}

/** The configured source a request URL belongs to: same origin, longest common path */
export function matchSource<T extends { url: string }>(requestUrl: string, sources: T[]): T | undefined {
    let request: URL;
    try {
        request = new URL(requestUrl);
    } catch {
        return undefined;
    }
    let best: { source: T; score: number } | undefined;
    for (const source of sources) {
        let url: URL;
        try {
            url = new URL(source.url);
        } catch {
            continue;
        }
        if (url.origin !== request.origin) {
            continue;
        }
        const a = url.pathname.split('/');
        const b = request.pathname.split('/');
        let score = 0;
        while (score < a.length && score < b.length && a[score] === b[score]) {
            score++;
        }
        if (!best || score > best.score) {
            best = { source, score };
        }
    }
    return best?.source;
}
