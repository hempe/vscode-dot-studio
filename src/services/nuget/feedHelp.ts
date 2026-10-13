/** What to do when a feed rejects its credentials, for the feeds teams commonly use */
export interface FeedHelp {
    /** Azure DevOps, GitHub Packages, ...; undefined for feeds we don't know */
    readonly provider?: string;
    /** Where to create a new token */
    readonly tokenUrl?: string;
    readonly steps: string[];
}

export function feedHelp(url: string): FeedHelp {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { steps: ['Check the source URL in NuGet.Config.'] };
    }
    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split('/').filter(Boolean);

    const azureOrg = host === 'pkgs.dev.azure.com' ? segments[0] : /^([^.]+)\.pkgs\.visualstudio\.com$/.exec(host)?.[1];
    if (azureOrg) {
        const tokenUrl = `https://dev.azure.com/${azureOrg}/_usersSettings/tokens`;
        return {
            provider: 'Azure DevOps',
            tokenUrl,
            steps: [
                `Create a personal access token in ${azureOrg} with the scope Packaging (Read), or Packaging (Read & write) to push packages.`,
                'Store it as the password of this source (Enter New Token); any non-empty username works.',
                'Alternative: the Azure Artifacts Credential Provider signs dotnet restore in without a stored token.',
            ],
        };
    }
    if (host === 'nuget.pkg.github.com') {
        return {
            provider: 'GitHub Packages',
            tokenUrl: 'https://github.com/settings/tokens',
            steps: [
                'Create a personal access token (classic) with the scope read:packages (write:packages to push).',
                `Store it as the password of this source (Enter New Token) with your GitHub user name${segments[0] ? `; the feed belongs to ${segments[0]}` : ''}.`,
            ],
        };
    }
    if (host.includes('gitlab') || parsed.pathname.includes('/packages/nuget')) {
        return {
            provider: 'GitLab',
            tokenUrl: `${parsed.origin}/-/user_settings/personal_access_tokens`,
            steps: [
                'Create a personal access token with the scope read_api (api to push), or use a deploy token with read_package_registry.',
                'Store it as the password of this source (Enter New Token) with your GitLab user name (or the deploy token name).',
            ],
        };
    }
    if (host.endsWith('.jfrog.io') || parsed.pathname.includes('/artifactory/')) {
        return {
            provider: 'JFrog Artifactory',
            tokenUrl: `${parsed.origin}/ui/user_profile`,
            steps: [
                'Generate an identity token in your Artifactory profile.',
                'Store it as the password of this source (Enter New Token) with your Artifactory user name.',
            ],
        };
    }
    if (host.endsWith('myget.org')) {
        return {
            provider: 'MyGet',
            tokenUrl: 'https://www.myget.org/profile/Me#!/AccessTokens',
            steps: [
                'Create an access token in your MyGet profile.',
                'Store it as the password of this source (Enter New Token) with your MyGet user name.',
            ],
        };
    }
    return {
        steps: [
            'Get a new token or password for this feed from whoever runs it.',
            'Store it as the password of this source (Enter New Token).',
        ],
    };
}
