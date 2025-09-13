import { PackageDiscoveryService } from '../../../services/packageDiscoveryService';

describe('PackageDiscoveryService (Simple Tests)', () => {
    describe('ensureArray utility', () => {
        it('should return empty array for null/undefined', () => {
            const ensureArray = (PackageDiscoveryService as any).ensureArray;
            
            const result1 = ensureArray(null);
            const result2 = ensureArray(undefined);
            
            if (!Array.isArray(result1) || result1.length !== 0) {
                throw new Error('Expected empty array for null');
            }
            if (!Array.isArray(result2) || result2.length !== 0) {
                throw new Error('Expected empty array for undefined');  
            }
        });

        it('should return array as-is', () => {
            const ensureArray = (PackageDiscoveryService as any).ensureArray;
            const inputArray = ['a', 'b', 'c'];
            
            const result = ensureArray(inputArray);
            
            if (result !== inputArray) {
                throw new Error('Expected same array reference');
            }
        });

        it('should wrap single value in array', () => {
            const ensureArray = (PackageDiscoveryService as any).ensureArray;
            const singleValue = 'test';
            
            const result = ensureArray(singleValue);
            
            if (!Array.isArray(result) || result.length !== 1 || result[0] !== 'test') {
                throw new Error('Expected single value wrapped in array');
            }
        });
    });

    describe('deduplicatePackages', () => {
        it('should remove duplicate packages by ID and version', () => {
            const deduplicatePackages = (PackageDiscoveryService as any).deduplicatePackages;
            
            const packages = [
                { id: 'Package1', version: '1.0.0', projectName: 'Project1', projectPath: '/path1' },
                { id: 'Package1', version: '1.0.0', projectName: 'Project2', projectPath: '/path2' },
                { id: 'Package2', version: '2.0.0', projectName: 'Project1', projectPath: '/path1' },
                { id: 'Package1', version: '1.1.0', projectName: 'Project3', projectPath: '/path3' }
            ];
            
            const result = deduplicatePackages(packages);
            
            if (result.length !== 3) {
                throw new Error(`Expected 3 unique packages, got ${result.length}`);
            }
            
            // Check that we have the right packages
            const packageKeys = result.map((p: any) => `${p.id}@${p.version}`);
            const expectedKeys = ['Package1@1.0.0', 'Package1@1.1.0', 'Package2@2.0.0'];
            
            for (const expectedKey of expectedKeys) {
                if (!packageKeys.includes(expectedKey)) {
                    throw new Error(`Missing expected package: ${expectedKey}`);
                }
            }
        });

        it('should sort packages alphabetically by ID', () => {
            const deduplicatePackages = (PackageDiscoveryService as any).deduplicatePackages;
            
            const packages = [
                { id: 'ZPackage', version: '1.0.0', projectName: 'Project1', projectPath: '/path1' },
                { id: 'APackage', version: '1.0.0', projectName: 'Project1', projectPath: '/path1' },
                { id: 'MPackage', version: '1.0.0', projectName: 'Project1', projectPath: '/path1' }
            ];
            
            const result = deduplicatePackages(packages);
            
            if (result[0].id !== 'APackage' || result[1].id !== 'MPackage' || result[2].id !== 'ZPackage') {
                throw new Error('Packages not sorted alphabetically');
            }
        });
    });

    describe('isPackageInstalled', () => {
        it('should handle errors gracefully', async () => {
            // This test verifies error handling without mocking
            try {
                const result = await PackageDiscoveryService.isPackageInstalled('/nonexistent/path.sln', 'TestPackage');
                
                // Should return false for non-existent solution
                if (result !== false) {
                    throw new Error('Expected false for non-existent solution');
                }
            } catch (error) {
                // Any error should be caught and return false
                throw new Error('isPackageInstalled should handle errors gracefully');
            }
        });
    });
});