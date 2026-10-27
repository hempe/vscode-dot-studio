import { PackageAdvisory } from '../../services/nuget/types';

const SEVERITIES = ['Critical', 'High', 'Moderate', 'Low'] as const;

/** The worst severity of the vulnerabilities (Critical, High, Moderate, Low), as NuGet names them */
export function worstSeverity(advisory: PackageAdvisory | undefined): string | undefined {
    const found = (advisory?.vulnerabilities ?? []).map(vulnerability => vulnerability.severity);
    if (found.length === 0) {
        return undefined;
    }
    return SEVERITIES.find(severity => found.some(value => value.toLowerCase() === severity.toLowerCase())) ?? found[0];
}

export interface AdvisoryBadge {
    readonly kind: 'vulnerable' | 'deprecated';
    readonly text: string;
    readonly title: string;
}

/** The small labels a row shows for a package: vulnerable (with the worst severity) and deprecated */
export function advisoryBadges(advisory: PackageAdvisory | undefined): AdvisoryBadge[] {
    const badges: AdvisoryBadge[] = [];
    const severity = worstSeverity(advisory);
    if (advisory?.vulnerabilities?.length && severity) {
        const count = advisory.vulnerabilities.length;
        badges.push({ kind: 'vulnerable', text: `vulnerable: ${severity.toLowerCase()}`, title: `${count} known ${count === 1 ? 'vulnerability' : 'vulnerabilities'} in this version` });
    }
    if (advisory?.deprecation) {
        const alternative = advisory.deprecation.alternative;
        badges.push({
            kind: 'deprecated',
            text: 'deprecated',
            title: `Deprecated (${advisory.deprecation.reasons.join(', ')})${alternative ? `; use ${alternative.id} instead` : ''}`,
        });
    }
    return badges;
}

/** Whether a package passes the "Vulnerable" and "Deprecated" filters (both off: everything; both on: either) */
export function passesAdvisoryFilter(advisory: PackageAdvisory | undefined, filter: { vulnerable: boolean; deprecated: boolean }): boolean {
    if (!filter.vulnerable && !filter.deprecated) {
        return true;
    }
    return (filter.vulnerable && !!advisory?.vulnerabilities?.length) || (filter.deprecated && !!advisory?.deprecation);
}
