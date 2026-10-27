import * as http from 'http';
import * as https from 'https';
import { responseText } from './httpBody';

export interface HttpResult {
    body: string;
    statusCode: number;
    etag?: string;
}

export interface HttpGetOptions {
    headers: Record<string, string>;
    /** Time without data before the request fails */
    idleTimeoutMs?: number;
    /** Time for the whole answer, redirects included */
    totalTimeoutMs?: number;
    /** Bytes of the (compressed) answer; more fails the request */
    maxBytes?: number;
    maxRedirects?: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET over https or http (a source can be `http://`), following redirects the way a NuGet client does. The
 * `Authorization` header goes only to the origin it was meant for: a redirect to another host, port or protocol
 * is followed without it. An answer bigger than `maxBytes` or slower than the total time fails.
 */
export function httpGet(url: string, options: HttpGetOptions): Promise<HttpResult> {
    const { idleTimeoutMs = 30000, totalTimeoutMs = 120000, maxBytes = 64 * 1024 * 1024, maxRedirects = 5 } = options;
    const deadline = Date.now() + totalTimeoutMs;

    return new Promise<HttpResult>((resolve, reject) => {
        const get = (target: URL, headers: Record<string, string>, redirectsLeft: number): void => {
            const client = target.protocol === 'http:' ? http : target.protocol === 'https:' ? https : undefined;
            if (!client) {
                reject(new Error(`Unsupported protocol ${target.protocol}`));
                return;
            }
            const request = client.request({
                hostname: target.hostname,
                port: target.port || (target.protocol === 'http:' ? 80 : 443),
                path: target.pathname + target.search,
                method: 'GET',
                headers,
            }, response => {
                const status = response.statusCode ?? 0;
                const location = response.headers['location'];
                if (REDIRECTS.has(status) && location) {
                    response.resume();
                    if (redirectsLeft <= 0) {
                        reject(new Error('Too many redirects'));
                        return;
                    }
                    const next = new URL(location, target);
                    const sameOrigin = next.origin === target.origin;
                    const { Authorization, ...withoutAuth } = headers;
                    get(next, sameOrigin ? headers : withoutAuth, redirectsLeft - 1);
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        request.destroy();
                        reject(new Error(`The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    try {
                        resolve({ statusCode: status, body: responseText(chunks, response.headers['content-encoding']), etag: response.headers['etag'] });
                    } catch (error) {
                        reject(error);
                    }
                });
                response.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(idleTimeoutMs, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
            const remaining = deadline - Date.now();
            const total = setTimeout(() => {
                request.destroy();
                reject(new Error('Request timeout'));
            }, Math.max(remaining, 1));
            request.on('close', () => clearTimeout(total));
            request.end();
        };

        try {
            get(new URL(url), options.headers, maxRedirects);
        } catch (error) {
            reject(error);
        }
    });
}
