jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/nuget/nugetCredentialManager', () => ({ NuGetCredentialManager: { getSourceToken: async () => undefined } }));

import { NuGetV3Service } from '../../../../services/nuget/nugetV3Service';

const entry = (version: string, authors: string) => ({
    catalogEntry: { '@type': 'PackageDetails', id: 'Pkg', version, authors, description: 'd' },
});

describe('NuGetV3Service.getPackageDetails', () => {
    it('reads the authors from registration pages that are not inlined', async () => {
        const pages: Record<string, unknown> = {
            'https://feed/index.json': { resources: [{ '@type': 'RegistrationsBaseUrl', '@id': 'https://feed/reg/' }] },
            'https://feed/reg/pkg/index.json': { items: [
                { '@id': 'https://feed/reg/pkg/page/0.json', lower: '0.1.0', upper: '0.9.0' },
                { '@id': 'https://feed/reg/pkg/page/1.json', lower: '1.0.0', upper: '2.0.0' },
                { '@id': 'https://feed/reg/pkg/page/2.json', lower: '0.0.1', upper: '0.0.9' },
                { '@id': 'https://feed/reg/pkg/page/3.json', lower: '0.0.1', upper: '0.0.5' },
            ] },
            'https://feed/reg/pkg/page/0.json': { items: [entry('0.5.0', '')] },
            'https://feed/reg/pkg/page/1.json': { items: [entry('1.0.0', 'Ann, Bob'), entry('2.0.0', 'Ann, Bob')] },
        };
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) =>
            url in pages ? { body: JSON.stringify(pages[url]), statusCode: 200 } : { body: '', statusCode: 404 });

        const details = await NuGetV3Service.getPackageDetails('Pkg', [{ name: 'f', url: 'https://feed/index.json', enabled: true } as any]);

        expect(details?.currentVersion).toBe('2.0.0');
        expect(details?.authors).toEqual(['Ann', 'Bob']);
    });
});
