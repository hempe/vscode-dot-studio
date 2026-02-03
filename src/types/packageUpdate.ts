export interface PackageUpdate {
    id: string;
    currentVersion: string;
    latestVersion: string;
    projects: string[];
    description?: string;
    releaseNotes?: string;
    isPrerelease: boolean;
    publishedDate?: string;
}

export interface UpdateCheckOptions {
    batchSize?: number;
}