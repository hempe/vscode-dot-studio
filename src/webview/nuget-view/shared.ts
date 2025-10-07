import { NuGetPackage, InstalledPackage } from "../../services/nuget/types";
import { logger } from "../shared/logger";
const log = logger('NuGetReact');

// Using shared NuGetPackage interface from types
export interface LocalNuGetPackage extends NuGetPackage {
    selected?: boolean;
    projectName?: string;
    projects?: {
        name: string;
        path: string;
        framework: string;
        packages: InstalledPackage[];
    }[];
}

// Helper function to format authors display
export function formatAuthors(authors?: string[] | string): string {
    if (!authors) return 'Unknown';
    if (Array.isArray(authors)) {
        return authors.join(', ');
    }
    return authors;
}

export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) {
        return value;
    }

    // Log unexpected non-array values (excluding null/undefined which are expected)
    if (value !== null && value !== undefined) {
        log.error('ensureArray: Expected array but received:', {
            type: typeof value,
            value: value,
            constructor: value?.constructor?.name
        });
    }

    return [];
};
