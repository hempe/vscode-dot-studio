// The bundles ship with the licence notices of the npm packages in them (review A7-3)
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { packageRootOf } = require('../../../../scripts/thirdPartyNotices');

describe('packageRootOf', () => {
    const sep = path.sep;
    const modules = `${sep}repo${sep}node_modules${sep}`;

    it('finds the package of a file', () => {
        expect(packageRootOf(`${modules}semver${sep}functions${sep}gt.js`)).toBe(`${modules}semver`);
    });

    it('keeps the scope of a scoped package', () => {
        expect(packageRootOf(`${modules}@iconify${sep}react${sep}dist${sep}iconify.mjs`)).toBe(`${modules}@iconify${sep}react`);
    });

    it('uses the innermost node_modules of a nested dependency', () => {
        expect(packageRootOf(`${modules}glob${sep}node_modules${sep}minimatch${sep}index.js`)).toBe(`${modules}glob${sep}node_modules${sep}minimatch`);
    });

    it('ignores our own files', () => {
        expect(packageRootOf(`${sep}repo${sep}src${sep}extension.ts`)).toBeUndefined();
    });
});
