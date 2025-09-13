import { PackageUpdateService } from '../../../services/packageUpdateService';

describe('PackageUpdateService (Simple Tests)', () => {
    describe('isNewerVersion', () => {
        it('should correctly compare major versions', () => {
            const result1 = PackageUpdateService.isNewerVersion('2.0.0', '1.0.0');
            const result2 = PackageUpdateService.isNewerVersion('1.0.0', '2.0.0');
            
            if (!result1) {
                throw new Error('Expected 2.0.0 to be newer than 1.0.0');
            }
            if (result2) {
                throw new Error('Expected 1.0.0 not to be newer than 2.0.0');
            }
        });

        it('should correctly compare minor versions', () => {
            const result1 = PackageUpdateService.isNewerVersion('1.2.0', '1.1.0');
            const result2 = PackageUpdateService.isNewerVersion('1.1.0', '1.2.0');
            
            if (!result1) {
                throw new Error('Expected 1.2.0 to be newer than 1.1.0');
            }
            if (result2) {
                throw new Error('Expected 1.1.0 not to be newer than 1.2.0');
            }
        });

        it('should correctly compare patch versions', () => {
            const result1 = PackageUpdateService.isNewerVersion('1.0.2', '1.0.1');
            const result2 = PackageUpdateService.isNewerVersion('1.0.1', '1.0.2');
            
            if (!result1) {
                throw new Error('Expected 1.0.2 to be newer than 1.0.1');
            }
            if (result2) {
                throw new Error('Expected 1.0.1 not to be newer than 1.0.2');
            }
        });

        it('should handle prerelease versions', () => {
            const result1 = PackageUpdateService.isNewerVersion('1.0.0', '1.0.0-beta');
            const result2 = PackageUpdateService.isNewerVersion('1.0.0-beta', '1.0.0');
            const result3 = PackageUpdateService.isNewerVersion('1.0.0-beta2', '1.0.0-beta1');
            
            if (!result1) {
                throw new Error('Expected stable version to be newer than prerelease');
            }
            if (result2) {
                throw new Error('Expected prerelease not to be newer than stable');
            }
            if (!result3) {
                throw new Error('Expected beta2 to be newer than beta1');
            }
        });

        it('should handle equal versions', () => {
            const result1 = PackageUpdateService.isNewerVersion('1.0.0', '1.0.0');
            const result2 = PackageUpdateService.isNewerVersion('1.0.0-beta', '1.0.0-beta');
            
            if (result1) {
                throw new Error('Expected equal versions to return false');
            }
            if (result2) {
                throw new Error('Expected equal prerelease versions to return false');
            }
        });
    });

    describe('isPrerelease', () => {
        it('should correctly identify prerelease versions', () => {
            const stable1 = PackageUpdateService.isPrerelease('1.0.0');
            const stable2 = PackageUpdateService.isPrerelease('2.1.3');
            const prerelease1 = PackageUpdateService.isPrerelease('1.0.0-beta');
            const prerelease2 = PackageUpdateService.isPrerelease('1.0.0-alpha.1');
            const prerelease3 = PackageUpdateService.isPrerelease('2.0.0-rc.1');
            
            if (stable1 || stable2) {
                throw new Error('Stable versions should not be identified as prerelease');
            }
            if (!prerelease1 || !prerelease2 || !prerelease3) {
                throw new Error('Prerelease versions should be identified correctly');
            }
        });
    });

    describe('getUpdateSummary', () => {
        it('should correctly categorize updates', () => {
            const updates = [
                {
                    id: 'Package1',
                    currentVersion: '1.0.0',
                    latestVersion: '2.0.0',
                    projects: ['Project1'],
                    isPrerelease: false
                },
                {
                    id: 'Package2', 
                    currentVersion: '1.0.0',
                    latestVersion: '1.1.0',
                    projects: ['Project1'],
                    isPrerelease: false
                },
                {
                    id: 'Package3',
                    currentVersion: '1.0.0',
                    latestVersion: '1.0.1',
                    projects: ['Project1'], 
                    isPrerelease: false
                },
                {
                    id: 'Package4',
                    currentVersion: '1.0.0',
                    latestVersion: '2.0.0-beta',
                    projects: ['Project1'],
                    isPrerelease: true
                }
            ];
            
            const summary = PackageUpdateService.getUpdateSummary(updates);
            
            if (summary.totalUpdates !== 4) {
                throw new Error(`Expected 4 total updates, got ${summary.totalUpdates}`);
            }
            if (summary.majorUpdates !== 1) {
                throw new Error(`Expected 1 major update, got ${summary.majorUpdates}`);
            }
            if (summary.minorUpdates !== 1) {
                throw new Error(`Expected 1 minor update, got ${summary.minorUpdates}`);
            }
            if (summary.patchUpdates !== 1) {
                throw new Error(`Expected 1 patch update, got ${summary.patchUpdates}`);
            }
            if (summary.prereleaseUpdates !== 1) {
                throw new Error(`Expected 1 prerelease update, got ${summary.prereleaseUpdates}`);
            }
        });

        it('should handle empty update list', () => {
            const summary = PackageUpdateService.getUpdateSummary([]);
            
            if (summary.totalUpdates !== 0) {
                throw new Error('Expected 0 total updates for empty list');
            }
            if (summary.majorUpdates !== 0 || summary.minorUpdates !== 0 || 
                summary.patchUpdates !== 0 || summary.prereleaseUpdates !== 0) {
                throw new Error('All update categories should be 0 for empty list');
            }
        });
    });
});