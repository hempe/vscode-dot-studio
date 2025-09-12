import * as sinon from 'sinon';
import { NuGetService, NuGetSearchOptions } from '../../../services/nugetService';

describe('NuGetService', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('searchPackages', () => {
        it('should return empty array for empty query', async () => {
            const result = await NuGetService.searchPackages({
                query: '',
                includePrerelease: false
            });
            
            sinon.assert.match(result, []);
        });

        it('should return empty array for query less than 2 characters', async () => {
            const result = await NuGetService.searchPackages({
                query: 'a',
                includePrerelease: false
            });
            
            sinon.assert.match(result, []);
        });

        it('should make HTTP request with correct parameters', async () => {
            const mockData = {
                data: [
                    {
                        id: 'Newtonsoft.Json',
                        version: '13.0.3',
                        description: 'Popular high-performance JSON framework for .NET',
                        totalDownloads: 2000000000
                    }
                ]
            };

            // Mock the private makeHttpRequest method
            const makeHttpRequestStub = sinon.stub(NuGetService as any, 'makeHttpRequest')
                .resolves(mockData);

            const options: NuGetSearchOptions = {
                query: 'json',
                includePrerelease: true,
                skip: 10,
                take: 50
            };

            const result = await NuGetService.searchPackages(options);

            sinon.assert.calledOnce(makeHttpRequestStub);
            const callArgs = makeHttpRequestStub.getCall(0).args[0];
            sinon.assert.match(callArgs.includes('q=json'), true);
            sinon.assert.match(callArgs.includes('skip=10'), true);
            sinon.assert.match(callArgs.includes('take=50'), true);
            sinon.assert.match(callArgs.includes('prerelease=true'), true);
            sinon.assert.match(result, mockData.data);
        });

        it('should handle API errors gracefully', async () => {
            sinon.stub(NuGetService as any, 'makeHttpRequest')
                .rejects(new Error('Network error'));

            try {
                await NuGetService.searchPackages({
                    query: 'test',
                    includePrerelease: false
                });
                sinon.assert.fail('Should have thrown an error');
            } catch (error) {
                sinon.assert.match((error as Error).message, /Failed to search packages/);
            }
        });
    });

    describe('validatePackageId', () => {
        it('should validate correct package IDs', () => {
            sinon.assert.match(NuGetService.validatePackageId('Newtonsoft.Json'), true);
            sinon.assert.match(NuGetService.validatePackageId('Microsoft.Extensions.Logging'), true);
            sinon.assert.match(NuGetService.validatePackageId('System.Text.Json'), true);
            sinon.assert.match(NuGetService.validatePackageId('Package_Name123'), true);
        });

        it('should reject invalid package IDs', () => {
            sinon.assert.match(NuGetService.validatePackageId(''), false);
            sinon.assert.match(NuGetService.validatePackageId('Package Name'), false);
            sinon.assert.match(NuGetService.validatePackageId('Package@Name'), false);
            sinon.assert.match(NuGetService.validatePackageId('Package/Name'), false);
        });
    });

    describe('validateVersion', () => {
        it('should validate correct version formats', () => {
            sinon.assert.match(NuGetService.validateVersion('1.0.0'), true);
            sinon.assert.match(NuGetService.validateVersion('2.1.3'), true);
            sinon.assert.match(NuGetService.validateVersion('1.0.0-beta'), true);
            sinon.assert.match(NuGetService.validateVersion('1.0.0+build.1'), true);
            sinon.assert.match(NuGetService.validateVersion('1.0.0-alpha.1+build.2'), true);
        });

        it('should reject invalid version formats', () => {
            sinon.assert.match(NuGetService.validateVersion(''), false);
            sinon.assert.match(NuGetService.validateVersion('1'), false);
            sinon.assert.match(NuGetService.validateVersion('v1.0.0'), false);
            sinon.assert.match(NuGetService.validateVersion('1.0.0.0.0'), false);
        });
    });
});