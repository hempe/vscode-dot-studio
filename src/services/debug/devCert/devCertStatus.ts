/** What `dotnet dev-certs https --check-trust-machine-readable` says about the HTTPS development certificate */
export interface DevCertStatus {
    /** none: no valid certificate; untrusted: one exists, nothing trusts it; partial: trusted by some stores only (Linux) */
    state: 'none' | 'untrusted' | 'partial' | 'trusted';
    /** The certificate expires within 30 days */
    expiresSoon?: boolean;
}

const RANK = { untrusted: 0, partial: 1, trusted: 2 } as const;
const SOON_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The best valid certificate of the command's output: a JSON array, possibly after lines of other text.
 * Certificates that are not valid now count as none; a missing TrustLevel counts as untrusted.
 * Undefined when the output holds no JSON array (the command failed or printed something else): that says nothing.
 */
export function parseDevCertStatus(output: string, now = new Date()): DevCertStatus | undefined {
    const items = readArray(output);
    if (!items) {
        return undefined;
    }
    let best: { rank: number; expires?: number } | undefined;
    for (const item of items) {
        if (!item || typeof item !== 'object' || (item as any).IsHttpsDevelopmentCertificate === false) {
            continue;
        }
        const { TrustLevel, ValidityNotBefore, ValidityNotAfter } = item as Record<string, unknown>;
        const from = typeof ValidityNotBefore === 'string' ? Date.parse(ValidityNotBefore) : NaN;
        const to = typeof ValidityNotAfter === 'string' ? Date.parse(ValidityNotAfter) : NaN;
        if (from > now.getTime() || to < now.getTime()) {
            continue;
        }
        const rank = TrustLevel === 'Full' ? RANK.trusted : TrustLevel === 'Partial' ? RANK.partial : RANK.untrusted;
        if (!best || rank > best.rank) {
            best = { rank, expires: Number.isNaN(to) ? undefined : to };
        }
    }
    if (!best) {
        return { state: 'none' };
    }
    const state = (['untrusted', 'partial', 'trusted'] as const)[best.rank];
    return best.expires !== undefined && best.expires - now.getTime() < SOON_MS ? { state, expiresSoon: true } : { state };
}

/** The JSON array that starts at the first line beginning with `[` (undefined when there is none or it does not parse) */
function readArray(output: string): unknown[] | undefined {
    const lines = output.split(/\r?\n/);
    const start = lines.findIndex(line => line.trimStart().startsWith('['));
    if (start < 0) {
        return undefined;
    }
    try {
        const value = JSON.parse(lines.slice(start).join('\n'));
        return Array.isArray(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Whether a launch profile's applicationUrl (`;` separated) has an https:// entry */
export function usesHttps(applicationUrl: string | undefined): boolean {
    return (applicationUrl ?? '').split(';').some(url => /^https:\/\//i.test(url.trim()));
}

/** Whether starting with this launch profile checks the certificate now */
export function shouldCheck(profile: { applicationUrl?: string } | undefined, enabled: boolean, alreadyChecked: boolean): boolean {
    return enabled && !alreadyChecked && usesHttps(profile?.applicationUrl);
}
