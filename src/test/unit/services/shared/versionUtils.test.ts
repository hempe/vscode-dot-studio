// Versions compare the way NuGet compares them (review A4-11, A8-02)
import { VersionUtils } from '../../../../services/shared/versionUtils';

const newer = (latest: string, installed: string) => VersionUtils.isOutdated(installed, latest);

describe('VersionUtils', () => {
    it('a fourth number makes a version newer, in either position', () => {
        expect(newer('1.2.3.1', '1.2.3')).toBe(true);
        expect(newer('1.2.3', '1.2.3.1')).toBe(false);
        expect(newer('1.2.3.0', '1.2.3')).toBe(false);
        expect(newer('4.6.0.1540', '4.6.0.999')).toBe(true);
    });

    it('a release is newer than its prereleases, and labels compare case-insensitively', () => {
        expect(newer('1.0.0', '1.0.0-rc.1')).toBe(true);
        expect(newer('1.0.0-RC1', '1.0.0-beta2')).toBe(true);
        expect(newer('1.0.0-beta2', '1.0.0-RC1')).toBe(false);
        expect(newer('1.0.0-BETA', '1.0.0-beta')).toBe(false);
        expect(newer('1.0.0-beta', '1.0.0-BETA')).toBe(false);
    });

    it('compares prerelease identifiers one by one: numbers numerically and below words, fewer below more', () => {
        expect(newer('1.0.0-beta.11', '1.0.0-beta.2')).toBe(true);
        expect(newer('1.0.0-beta', '1.0.0-alpha.9')).toBe(true);
        expect(newer('1.0.0-alpha.beta', '1.0.0-alpha.1')).toBe(true);
        expect(newer('1.0.0-alpha.1', '1.0.0-alpha')).toBe(true);
    });

    it('ignores build metadata', () => {
        expect(newer('1.0.0+b2', '1.0.0+b1')).toBe(false);
    });

    it('any -label is a prerelease, also on four-part versions', () => {
        expect(VersionUtils.isPrerelease('4.6.0.1-ci0042')).toBe(true);
        expect(VersionUtils.isPrerelease('1.2.3.4-nightly')).toBe(true);
        expect(VersionUtils.isPrerelease('1.0.0-beta.2')).toBe(true);
        expect(VersionUtils.isPrerelease('1.0.0')).toBe(false);
        expect(VersionUtils.isPrerelease('1.0.0+build-5')).toBe(false);
        expect(VersionUtils.isPrerelease('')).toBe(false);
    });

    it('findLatest takes the highest stable version', () => {
        expect(VersionUtils.findLatest(['1.0.0', '2.0.0-beta', '1.5.0', '1.5.0.1'])).toBe('1.5.0.1');
    });

    it('unknown installed versions are never outdated', () => {
        expect(VersionUtils.isOutdated('', '2.0.0')).toBe(false);
        expect(VersionUtils.isOutdated('[1.0.0, )', '2.0.0')).toBe(true);
    });
});
