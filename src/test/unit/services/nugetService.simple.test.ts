import { NuGetService } from '../../../services/nugetService';

describe('NuGetService (Simple Tests)', () => {
    describe('validatePackageId', () => {
        it('should validate correct package IDs', () => {
            const validIds = [
                'Newtonsoft.Json',
                'Microsoft.Extensions.Logging',
                'System.Text.Json',
                'Package_Name123',
                'My-Package.Core'
            ];

            for (const id of validIds) {
                const result = NuGetService.validatePackageId(id);
                if (!result) {
                    throw new Error(`Expected ${id} to be valid`);
                }
            }
        });

        it('should reject invalid package IDs', () => {
            const invalidIds = [
                '',
                'Package Name',
                'Package@Name',
                'Package/Name',
                'Package\\Name'
            ];

            for (const id of invalidIds) {
                const result = NuGetService.validatePackageId(id);
                if (result) {
                    throw new Error(`Expected ${id} to be invalid`);
                }
            }
        });
    });

    describe('validateVersion', () => {
        it('should validate correct version formats', () => {
            const validVersions = [
                '1.0',
                '1.0.0',
                '2.1.3',
                '1.0.0-beta',
                '1.0.0-alpha.1',
                '10.15.23'
            ];

            for (const version of validVersions) {
                const result = NuGetService.validateVersion(version);
                if (!result) {
                    throw new Error(`Expected ${version} to be valid`);
                }
            }
        });

        it('should reject invalid version formats', () => {
            const invalidVersions = [
                '',
                '1',
                'v1.0.0',
                '1.0.0.0.0',
                'invalid'
            ];

            for (const version of invalidVersions) {
                const result = NuGetService.validateVersion(version);
                if (result) {
                    throw new Error(`Expected ${version} to be invalid`);
                }
            }
        });
    });
});