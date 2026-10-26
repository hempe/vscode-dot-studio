// Reading NuGet responses (review A4-4, A4-12)
import * as zlib from 'zlib';
import { pickRegistrationUrl, responseText } from '../../../../services/nuget/httpBody';

describe('responseText', () => {
    it('decodes a multi-byte character that is split across chunks', () => {
        const bytes = Buffer.from('Möbius – Übersicht 日本語', 'utf8');
        const chunks = [bytes.subarray(0, 2), bytes.subarray(2, 14), bytes.subarray(14)];
        expect(responseText(chunks)).toBe('Möbius – Übersicht 日本語');
    });

    it('unzips gzip, by header or by the magic number', () => {
        const zipped = zlib.gzipSync(Buffer.from('{"items":[]}'));
        expect(responseText([zipped], 'gzip')).toBe('{"items":[]}');
        expect(responseText([zipped.subarray(0, 5), zipped.subarray(5)])).toBe('{"items":[]}');
    });

    it('leaves plain text alone', () => {
        expect(responseText([Buffer.from('plain')], undefined)).toBe('plain');
        expect(responseText([])).toBe('');
    });
});

describe('pickRegistrationUrl', () => {
    const resource = (type: string, id: string) => ({ '@type': type, '@id': id });

    it('takes the SemVer 2 registration of nuget.org, not the first one', () => {
        expect(pickRegistrationUrl([
            resource('SearchQueryService', 'https://search'),
            resource('RegistrationsBaseUrl', 'https://api.nuget.org/v3/registration5-semver1/'),
            resource('RegistrationsBaseUrl/3.4.0', 'https://api.nuget.org/v3/registration5-gz-semver1/'),
            resource('RegistrationsBaseUrl/3.6.0', 'https://api.nuget.org/v3/registration5-gz-semver2/'),
        ])).toBe('https://api.nuget.org/v3/registration5-gz-semver2/');
    });

    it('falls back to the plain resource of a feed that has no versioned ones, and to null', () => {
        expect(pickRegistrationUrl([resource('RegistrationsBaseUrl', 'https://feed/reg/')])).toBe('https://feed/reg/');
        expect(pickRegistrationUrl([resource('SearchQueryService', 'https://search')])).toBeNull();
    });
});
