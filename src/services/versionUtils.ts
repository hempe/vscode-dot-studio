import * as semver from 'semver';

/**
 * Version comparison utilities that handle both semantic versioning and non-semver formats
 * Common in .NET ecosystem where packages may use 4-part versioning (1.2.3.4)
 */
export class VersionUtils {

    /**
     * Compare two version strings, handling both semver and non-semver formats
     * @param a First version string
     * @param b Second version string
     * @returns Descending order, for sorting the newest first: -1 if a is the higher version, 1 if b is, 0 if equal
     */
    static compare(a: string, b: string): number {
        return comp(a, b) * -1;
    }

    /**
     * Find the latest (highest) version from an array of version strings
     * @param versions Array of version strings
     * @returns Latest version string or null if array is empty
     */
    static findLatest(versions: string[]): string | null {
        if (!versions || versions.length === 0) return null;

        // Filter out prereleases (versions with -alpha, -beta, -rc, etc.)
        const stableVersions = versions.filter(v => v && !v.includes('-'));

        // If no stable versions, use all versions
        const candidateVersions = stableVersions.length > 0 ? stableVersions : versions;

        if (candidateVersions.length === 0) return null;

        // Sort in descending order and return the first (highest)
        return candidateVersions.sort((a, b) => this.compare(a, b))[0];
    }

    /**
     * Extract major version number from a version string
     * @param version Version string
     * @returns Major version number or 0 if cannot be determined
     */
    static getMajorVersion(version: string): number {
        if (!version) return 0;

        // Try semver first
        if (semver.valid(version)) {
            return semver.major(version);
        }

        // Fallback to manual parsing
        const parts = parseVersionParts(version);
        return parts[0] || 0;
    }

    /**
     * Whether `latest` is newer than the installed `current` version. A version that is not known ('' when MSBuild
     * could not tell, or anything not starting with a number) is never outdated; a range like `[2.0.3, )` counts as
     * its lower bound.
     */
    static isOutdated(current: string, latest: string | undefined): boolean {
        const installed = (current ?? '').trim().replace(/^\[\s*/, '').split(/[\s,\]]/)[0];
        if (!latest || !/^\d/.test(installed)) {
            return false;
        }
        return comp(latest, installed) > 0;
    }

    static includePrerelease(includePrerelease: boolean): (versions: string) => boolean {
        if (includePrerelease)
            return (version) => !!version;

        return (version) => !!version && !VersionUtils.isPrerelease(version);
    }

    /**
     * Check if a version is a prerelease version
     * @param version Version string to check
     * @returns true if it's a prerelease version
     */
    static isPrerelease(version: string): boolean {
        // NuGet: any `-label` makes a version a prerelease (4.6.0.1-ci0042 as well as 1.0.0-beta.2)
        return !!version && labelOf(version.trim()) !== undefined;
    }
}

/**
 * Compare two NuGet versions the way NuGet does: any number of numeric parts (1.2.3.4), missing ones count as 0; with equal
 * numbers a version without a `-label` is newer than one with; labels compare by their dot-separated identifiers (numbers
 * numerically and below words, words case-insensitively, fewer identifiers below more); `+metadata` is ignored.
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
function comp(a: string, b: string): number {
    // Handle null/undefined/empty versions
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const numbers = compareNonSemver(a, b);
    if (numbers !== 0) {
        return numbers;
    }
    return comparePrerelease(labelOf(a), labelOf(b));
}

/** The prerelease label of a version (`beta.2` of `1.0.0-beta.2+build`), or undefined */
function labelOf(version: string): string | undefined {
    const withoutMetadata = version.split('+')[0];
    const dash = withoutMetadata.indexOf('-');
    return dash < 0 ? undefined : withoutMetadata.slice(dash + 1);
}

function comparePrerelease(a: string | undefined, b: string | undefined): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1; // a release is newer than its prereleases
    if (b === undefined) return -1;
    const left = a.split('.');
    const right = b.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (left[i] === undefined) return -1;
        if (right[i] === undefined) return 1;
        const leftNumeric = /^\d+$/.test(left[i]);
        const rightNumeric = /^\d+$/.test(right[i]);
        if (leftNumeric && rightNumeric) {
            const difference = Number(left[i]) - Number(right[i]);
            if (difference !== 0) return difference > 0 ? 1 : -1;
        } else if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1; // numbers are below words
        } else {
            const order = left[i].toLowerCase().localeCompare(right[i].toLowerCase(), 'en', { sensitivity: 'base' });
            if (order !== 0) return order > 0 ? 1 : -1;
        }
    }
    return 0;
}

/**
 * Compare the numeric parts of two versions (any number of them)
 */
function compareNonSemver(a: string, b: string): number {
    // Split versions into parts and convert to numbers
    const aParts = parseVersionParts(a);
    const bParts = parseVersionParts(b);

    // Compare each part
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
        const aPart = aParts[i] || 0; // Default to 0 if part doesn't exist
        const bPart = bParts[i] || 0;

        if (aPart > bPart) return 1;
        if (aPart < bPart) return -1;
    }

    return 0; // All parts are equal
}


/**
 * Parse version string into numeric parts, handling various formats
 */
function parseVersionParts(version: string): number[] {
    if (!version) return [0];

    // Remove any non-digit, non-dot characters (like 'v' prefix, prerelease suffixes)
    const cleanVersion = version.replace(/^v/, '').split(/[-+]/)[0];

    // Split by dots and convert to numbers
    return cleanVersion.split('.').map(part => {
        const num = parseInt(part, 10);
        return isNaN(num) ? 0 : num;
    });
}