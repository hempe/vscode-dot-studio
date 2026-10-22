import * as http from 'http';
import * as https from 'https';

/**
 * Downloads a file (a `.proto` for a gRPC reference) over http(s), following up to five redirects (raw.githubusercontent
 * and similar hosts redirect). Rejects on any status but 200 and when the server does not answer within `timeoutMs`.
 */
export function download(url: string, timeoutMs = 30000, redirects = 5): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = /^https:/i.test(url) ? https : http;
        const request = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'shinobi-dotnet' } }, response => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (status >= 300 && status < 400 && location) {
                response.resume();
                if (redirects <= 0) {
                    reject(new Error(`Too many redirects from ${url}`));
                    return;
                }
                download(new URL(location, url).toString(), timeoutMs, redirects - 1).then(resolve, reject);
                return;
            }
            if (status !== 200) {
                response.resume();
                reject(new Error(`${url} answered ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}`));
                return;
            }
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error(`${url} did not answer within ${timeoutMs / 1000} s`)));
        request.on('error', reject);
    });
}
