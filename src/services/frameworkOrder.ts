import { VersionUtils } from './versionUtils';

/** The rank of a target framework name as a version, so the newest sorts first: modern .NET above .NET Core above .NET Framework above .NET Standard */
function rank(framework: string): string {
    const modern = /^net(\d+)\.(\d+)/.exec(framework);
    if (modern) {
        return `9.${modern[1]}.${modern[2]}`;
    }
    const core = /^netcoreapp(\d+)\.(\d+)$/.exec(framework);
    if (core) {
        return `5.${core[1]}.${core[2]}`;
    }
    const netFramework = /^net(\d)(\d)(\d+)?$/.exec(framework);
    if (netFramework) {
        return `2.${netFramework[1]}.${netFramework[2]}.${netFramework[3] ?? '0'}`;
    }
    const standard = /^netstandard(\d+)\.(\d+)$/.exec(framework);
    if (standard) {
        return `1.${standard[1]}.${standard[2]}`;
    }
    return '0.0.0';
}

/** Target frameworks, newest first (in place, like Array.sort) */
export function sortFrameworksByVersion(frameworks: string[]): string[] {
    return frameworks.sort((a, b) => VersionUtils.compare(rank(a), rank(b)));
}
