export interface PackageConflict {
    packageId: string;
    versions: Array<{
        version: string;
        projects: Array<{
            projectName: string;
            projectPath: string;
        }>;
        usageCount: number;
    }>;
    recommendedVersion: string;
    conflictSeverity: 'low' | 'medium' | 'high';
    impactDescription: string;
}

export interface ConsolidationSummary {
    totalPackages: number;
    conflictedPackages: number;
    totalProjects: number;
    conflictSeverity: {
        high: number;
        medium: number;
        low: number;
    };
}