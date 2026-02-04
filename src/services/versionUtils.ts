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
     * @returns 1 if a > b, -1 if a < b, 0 if equal
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
        if (!version) return false;

        // If it's a valid semver, use semver parsing
        if (semver.valid(version)) {
            try {
                const parsed = semver.parse(version);
                return parsed !== null && parsed.prerelease.length > 0;
            } catch {
                return false;
            }
        }

        // Fallback: check for common prerelease identifiers
        const prereleasePatterns = ['-alpha', '-beta', '-rc', '-preview', '-pre', '-dev'];
        return prereleasePatterns.some(pattern => version.toLowerCase().includes(pattern));
    }
}

/**
 * Compare two version strings, handling both semver and non-semver formats
 * @param a First version string
 * @param b Second version string
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
function comp(a: string, b: string): number {
    // Handle null/undefined/empty versions
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    // Check if both versions are valid semver
    const aValid = semver.valid(a);
    const bValid = semver.valid(b);

    if (aValid && bValid) {
        // Both are valid semver, use semver comparison
        return semver.compare(a, b);
    }

    // At least one is not valid semver, use custom comparison
    return compareNonSemver(a, b);
}

/**
 * Custom version comparison for non-semver formats (like 4-part .NET versions)
 * Handles versions like "1.2.3.4", "1.0.0.1540", etc.
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