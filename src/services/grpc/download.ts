import * as http from 'http';
import * as https from 'https';

/** What download needs of a VS Code CancellationToken (no `vscode` here) */
export interface Cancellation {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface DownloadOptions {
    /** Deadline for the whole download, redirects included (not an idle timeout) */
    readonly timeoutMs?: number;
    /** Larger answers are refused and the request aborted */
    readonly maxBytes?: number;
    readonly token?: Cancellation;
}

/** The download was cancelled (from the progress notification): nothing to report as an error */
export class DownloadCancelled extends Error {
    constructor() {
        super('The download was cancelled.');
        this.name = 'DownloadCancelled';
    }
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The URL without what may be a secret, for messages and the output: user info and query become `***`.
 * Nothing else changes (escapes stay as written).
 */
export function redactUrl(url: string): string {
    return url
        .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@')
        .replace(/\?[^#]*/, '?***');
}

/**
 * Downloads a file (a `.proto` for a gRPC reference) over http(s), following up to five redirects (raw.githubusercontent
 * and similar hosts redirect), never from https to http. Rejects on any status but 200, on a web page (text/html: a
 * sign-in page is not a `.proto`), on answers larger than `maxBytes` (5 MB), when the whole download takes longer than
 * `timeoutMs`, and with DownloadCancelled when `token` is cancelled. Messages show the URL without credentials.
 */
export function download(url: string, options: DownloadOptions = {}): Promise<Buffer> {
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const shown = redactUrl(url);
    return new Promise((resolve, reject) => {
        let request: http.ClientRequest | undefined;
        let settled = false;
        const finish = (error: Error | undefined, result?: Buffer) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(deadline);
            subscription?.dispose();
            if (error) {
                request?.destroy();
                reject(error);
            } else {
                resolve(result!);
            }
        };
        const deadline = setTimeout(() => finish(new Error(`${shown} did not answer within ${timeoutMs / 1000} s`)), timeoutMs);
        const subscription = options.token?.onCancellationRequested(() => finish(new DownloadCancelled()));
        if (options.token?.isCancellationRequested) {
            finish(new DownloadCancelled());
            return;
        }

        const get = (current: string, redirects: number) => {
            const client = /^https:/i.test(current) ? https : http;
            request = client.get(current, { headers: { 'User-Agent': 'shinobi-dotnet' } }, response => {
                const status = response.statusCode ?? 0;
                const location = response.headers.location;
                if (status >= 300 && status < 400 && location) {
                    response.resume();
                    if (redirects <= 0) {
                        finish(new Error(`Too many redirects from ${shown}`));
                        return;
                    }
                    const next = new URL(location, current).toString();
                    if (/^https:/i.test(current) && !/^https:/i.test(next)) {
                        finish(new Error(`${shown} redirected from https to http (${redactUrl(next)}): refused`));
                        return;
                    }
                    get(next, redirects - 1);
                    return;
                }
                if (status !== 200) {
                    response.resume();
                    finish(new Error(`${shown} answered ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}`));
                    return;
                }
                if (/^\s*text\/html\b/i.test(String(response.headers['content-type'] ?? ''))) {
                    response.resume();
                    finish(new Error(`${shown} answered with a web page (text/html), not a .proto file (a sign-in page?)`));
                    return;
                }
                const tooLarge = () => new Error(`${shown} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB: refused`);
                if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
                    finish(tooLarge());
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        finish(tooLarge());
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => finish(undefined, Buffer.concat(chunks)));
                response.on('error', error => finish(error));
            });
            request.on('error', error => finish(new Error(error.message.split(current).join(redactUrl(current)))));
        };
        get(url, 5);
    });
}
