export interface NuGetPackage {
    id: string;
    version: string;
    description: string;
    totalDownloads: number;
    versions?: Array<{ version: string }>;
}

export interface NuGetSearchOptions {
    query: string;
    includePrerelease: boolean;
    skip?: number;
    take?: number;
}