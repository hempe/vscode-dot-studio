export interface NuGetPackage {
    id: string;
    version: string;
    description: string;
    totalDownloads: number;
    versions?: Array<{ version: string }>;
}

export interface NuGetSearchOptions {
    query: string;
    skip?: number;
    take?: number;
}