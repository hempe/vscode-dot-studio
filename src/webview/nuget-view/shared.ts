import { NuGetPackage, InstalledPackage, PackageVersionSource } from "../../services/nuget/types";
import { logger } from "../shared/logger";
import { BackendCmd } from "../../types/commands/backend";
import { UICmd } from "../../types/commands/ui";
import type * as vscode from 'vscode';

const log = logger('NuGetReact');

// Using shared NuGetPackage interface from types
export interface LocalNuGetPackage extends NuGetPackage {
    selected?: boolean;
    projectName?: string;
    /** Transitive packages: the top-level packages that bring it in */
    transitiveReferencedBy?: string[];
    /** Installed packages: where the version comes from (Central Package Management) */
    versionSource?: PackageVersionSource;
    /** Installed packages: the file the version is written in */
    versionFile?: string;
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

declare global {
    interface Window {
        acquireVsCodeApi(): any;
    }
}

const vs: { postMessage(message: BackendCmd): void } = window.acquireVsCodeApi();


export function sendToBackend(message: BackendCmd) {
    vs.postMessage(message)
}

export function sendToUi(webview: vscode.Webview | undefined, cmd: UICmd) {
    webview?.postMessage(cmd);
}