import * as zlib from 'zlib';

/**
 * The text of a response from its chunks: decoded once as a whole (a multi-byte character can be split across chunks) and
 * unzipped when it is gzip (the `Content-Encoding` says so, or the bytes start with the gzip magic number: the
 * registration hive for SemVer 2 is stored gzipped)
 */
export function responseText(chunks: readonly Buffer[], contentEncoding?: string): string {
    let body = Buffer.concat(chunks);
    const gzip = /\bgzip\b/i.test(contentEncoding ?? '') || (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b);
    if (gzip) {
        body = zlib.gunzipSync(body);
    }
    return body.toString('utf8');
}

/**
 * The URL to read package details from: the registration resource that lists SemVer 2.0.0 versions (`RegistrationsBaseUrl/3.6.0`,
 * what the NuGet client uses), else the older ones. The unversioned `RegistrationsBaseUrl` of nuget.org leaves out every
 * version with a dotted prerelease label or build metadata.
 */
export function pickRegistrationUrl(resources: readonly { '@id'?: string; '@type'?: string }[]): string | null {
    const typed = (suffix: string) => resources.find(resource => resource['@type'] === `RegistrationsBaseUrl${suffix}`);
    const candidate = typed('/3.6.0') ?? typed('/Versioned') ?? typed('/3.4.0') ?? typed('')
        ?? resources.find(resource => resource['@type']?.startsWith('RegistrationsBaseUrl'));
    return candidate?.['@id'] ?? null;
}
