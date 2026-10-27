import { execDotnet } from './dotnetCli';
import { advisoryKey, PackageAdvisories, PackageAdvisory } from './types';
import { logger } from '../../core/logger';

const log = logger('PackageAdvisories');

interface ListedPackage {
    id?: string;
    resolvedVersion?: string;
    vulnerabilities?: { severity?: string; advisoryurl?: string }[];
    deprecationReasons?: string[];
    alternativePackage?: { id?: string; versionRange?: string };
}

/** The packages (top-level and transitive, of every project and framework) in the JSON of `dotnet list package` */
function listedPackages(json: string): ListedPackage[] {
    try {
        const data = JSON.parse(json);
        return (data.projects ?? []).flatMap((project: any) => (project.frameworks ?? []).flatMap((framework: any) =>
            [...(framework.topLevelPackages ?? []), ...(framework.transitivePackages ?? [])]));
    } catch {
        return [];
    }
}

/**
 * The vulnerabilities and deprecations `dotnet list package --vulnerable --format json` and `--deprecated --format json`
 * report, by package version. Both lists may be empty or unreadable.
 */
export function parseAdvisories(vulnerableJson: string, deprecatedJson: string): PackageAdvisories {
    const result: Record<string, PackageAdvisory> = {};
    const entry = (listed: ListedPackage) => (listed.id && listed.resolvedVersion ? advisoryKey(listed.id, listed.resolvedVersion) : undefined);

    for (const listed of listedPackages(vulnerableJson)) {
        const key = entry(listed);
        if (key && listed.vulnerabilities?.length) {
            const known = result[key]?.vulnerabilities ?? [];
            const added = listed.vulnerabilities
                .filter(vulnerability => vulnerability.advisoryurl && !known.some(existing => existing.url === vulnerability.advisoryurl))
                .map(vulnerability => ({ severity: vulnerability.severity ?? 'Unknown', url: vulnerability.advisoryurl! }));
            result[key] = { ...result[key], vulnerabilities: [...known, ...added] };
        }
    }
    for (const listed of listedPackages(deprecatedJson)) {
        const key = entry(listed);
        if (key && listed.deprecationReasons?.length) {
            result[key] = {
                ...result[key],
                deprecation: {
                    reasons: listed.deprecationReasons,
                    alternative: listed.alternativePackage?.id ? { id: listed.alternativePackage.id, range: listed.alternativePackage.versionRange } : undefined,
                },
            };
        }
    }
    return result;
}

/** Joins the advisories of several projects */
export function mergeAdvisories(all: readonly PackageAdvisories[]): PackageAdvisories {
    const merged: Record<string, PackageAdvisory> = {};
    for (const advisories of all) {
        for (const [key, advisory] of Object.entries(advisories)) {
            const known = merged[key]?.vulnerabilities ?? [];
            const vulnerabilities = [...known, ...(advisory.vulnerabilities ?? []).filter(v => !known.some(existing => existing.url === v.url))];
            merged[key] = { ...merged[key], ...advisory, ...(vulnerabilities.length ? { vulnerabilities } : {}) };
        }
    }
    return merged;
}

/** Runs the two lists for a project (a restore must have happened; the answer needs the feeds' vulnerability data) */
export async function readProjectAdvisories(projectPath: string): Promise<PackageAdvisories> {
    const list = async (flag: string): Promise<string> => {
        try {
            return (await execDotnet(['list', projectPath, 'package', flag, '--include-transitive', '--format', 'json'], { timeout: 120000 })).stdout;
        } catch (error) {
            log.warn(`dotnet list package ${flag} failed for ${projectPath}:`, error);
            return '';
        }
    };
    const [vulnerable, deprecated] = await Promise.all([list('--vulnerable'), list('--deprecated')]);
    return parseAdvisories(vulnerable, deprecated);
}
