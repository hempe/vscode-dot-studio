// Names typed for a new or renamed file or folder must stay in the folder (review A2-6)
import { itemNameProblem } from '../../../../services/project/itemNames';

describe('itemNameProblem', () => {
    it.each(['Program.cs', 'My File.txt', '.editorconfig', 'a.b.c', 'Ünï.cs', 'x'])('accepts %s', name => {
        expect(itemNameProblem(name)).toBeUndefined();
    });

    it.each([
        ['', 'empty'],
        ['   ', 'blank'],
        ['.', 'dot'],
        ['..', 'dot dot'],
        ['../x', 'parent'],
        ['a/b.cs', 'slash'],
        ['a\\b.cs', 'backslash'],
        ['a:b', 'colon'],
        ['a*b', 'star'],
        ['a?b', 'question mark'],
        ['a"b', 'quote'],
        ['a<b', 'less than'],
        ['a|b', 'pipe'],
        ['a\u0000b', 'NUL'],
        ['x.', 'trailing dot'],
        ['x ', 'trailing space'],
        ['CON', 'reserved name'],
        ['nul.txt', 'reserved name with extension'],
    ])('refuses %j (%s)', name => {
        expect(itemNameProblem(name)).toEqual(expect.any(String));
    });
});
