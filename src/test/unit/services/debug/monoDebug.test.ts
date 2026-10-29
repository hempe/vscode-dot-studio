jest.mock('vscode', () => ({}), { virtual: true });

import { splitArguments } from '../../../../services/debug/monoDebug';

describe('splitArguments', () => {
    it('splits on spaces and keeps quoted text together', () => {
        expect(splitArguments('--verbose "two words" -x=1')).toEqual(['--verbose', 'two words', '-x=1']);
    });

    it('gives no arguments for nothing', () => {
        expect(splitArguments(undefined)).toEqual([]);
        expect(splitArguments('   ')).toEqual([]);
    });
});
