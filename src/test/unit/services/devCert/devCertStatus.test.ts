import { parseDevCertStatus, shouldCheck, usesHttps } from '../../../../services/devCert/devCertStatus';

const NOW = new Date('2026-10-20T12:00:00Z');
const cert = (trust: string, extra: Record<string, unknown> = {}) => ({
    Thumbprint: 'AB', IsHttpsDevelopmentCertificate: true, TrustLevel: trust,
    ValidityNotBefore: '2026-01-01T00:00:00+00:00', ValidityNotAfter: '2027-01-01T00:00:00+00:00', ...extra,
});

describe('parseDevCertStatus', () => {
    it('is none for an empty array', () => {
        expect(parseDevCertStatus('[]', NOW)).toEqual({ state: 'none' });
        expect(parseDevCertStatus('An issue was encountered verifying workloads.\n[]\n', NOW)).toEqual({ state: 'none' });
    });

    it('is undefined when the output has no JSON array', () => {
        expect(parseDevCertStatus('', NOW)).toBeUndefined();
        expect(parseDevCertStatus('no certificate here', NOW)).toBeUndefined();
        expect(parseDevCertStatus('[ {broken', NOW)).toBeUndefined();
    });

    it('maps the trust levels', () => {
        expect(parseDevCertStatus(JSON.stringify([cert('None')]), NOW)?.state).toBe('untrusted');
        expect(parseDevCertStatus(JSON.stringify([cert('Partial')]), NOW)?.state).toBe('partial');
        expect(parseDevCertStatus(JSON.stringify([cert('Full')]), NOW)?.state).toBe('trusted');
    });

    it('takes the best certificate', () => {
        expect(parseDevCertStatus(JSON.stringify([cert('None'), cert('Full'), cert('Partial')]), NOW)?.state).toBe('trusted');
    });

    it('tolerates text lines before the JSON and a pretty printed array', () => {
        const output = 'Some notice\nAnother line\n' + JSON.stringify([cert('Full')], null, 2) + '\n';
        expect(parseDevCertStatus(output, NOW)?.state).toBe('trusted');
    });

    it('ignores expired and not yet valid certificates', () => {
        expect(parseDevCertStatus(JSON.stringify([cert('Full', { ValidityNotAfter: '2026-06-01T00:00:00Z' })]), NOW)).toEqual({ state: 'none' });
        expect(parseDevCertStatus(JSON.stringify([cert('Full', { ValidityNotBefore: '2026-11-01T00:00:00Z' })]), NOW)).toEqual({ state: 'none' });
        expect(parseDevCertStatus(JSON.stringify([cert('Full', { ValidityNotAfter: '2026-06-01T00:00:00Z' }), cert('None')]), NOW)?.state).toBe('untrusted');
    });

    it('ignores certificates that are not HTTPS development certificates', () => {
        expect(parseDevCertStatus(JSON.stringify([cert('Full', { IsHttpsDevelopmentCertificate: false })]), NOW)).toEqual({ state: 'none' });
    });

    it('tolerates missing properties', () => {
        expect(parseDevCertStatus(JSON.stringify([{ TrustLevel: 'Full' }]), NOW)?.state).toBe('trusted');
        expect(parseDevCertStatus(JSON.stringify([{ Thumbprint: 'AB' }]), NOW)?.state).toBe('untrusted');
        expect(parseDevCertStatus('[null, 3, "x"]', NOW)).toEqual({ state: 'none' });
    });

    it('flags a certificate that expires within 30 days', () => {
        const soon = cert('Full', { ValidityNotAfter: '2026-11-01T00:00:00Z' });
        expect(parseDevCertStatus(JSON.stringify([soon]), NOW)).toEqual({ state: 'trusted', expiresSoon: true });
        expect(parseDevCertStatus(JSON.stringify([cert('Full')]), NOW)?.expiresSoon).toBeUndefined();
    });
});

describe('usesHttps', () => {
    it('finds an https entry in the semicolon separated list', () => {
        expect(usesHttps('https://localhost:7275;http://localhost:5181')).toBe(true);
        expect(usesHttps('http://localhost:5181; HTTPS://localhost:7275')).toBe(true);
    });

    it('is false for http only and without a url', () => {
        expect(usesHttps('http://localhost:5181')).toBe(false);
        expect(usesHttps('http://https.example')).toBe(false);
        expect(usesHttps(undefined)).toBe(false);
        expect(usesHttps('')).toBe(false);
    });
});

describe('shouldCheck', () => {
    const https = { applicationUrl: 'https://localhost:7275' };
    it('checks https profiles once while enabled', () => {
        expect(shouldCheck(https, true, false)).toBe(true);
        expect(shouldCheck(https, true, true)).toBe(false);
        expect(shouldCheck(https, false, false)).toBe(false);
        expect(shouldCheck({ applicationUrl: 'http://localhost:5181' }, true, false)).toBe(false);
        expect(shouldCheck(undefined, true, false)).toBe(false);
    });
});
