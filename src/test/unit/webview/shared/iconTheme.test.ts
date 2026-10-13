import { fontGlyph, resolveThemeIcon } from '../../../../webview/shared/iconTheme';
import { IconThemePayload } from '../../../../types/iconTheme';

const theme: IconThemePayload = {
    icons: {
        _file: { svg: 'file.svg' }, _folder: { svg: 'folder.svg' }, _folderOpen: { svg: 'folder-open.svg' },
        _ts: { svg: 'ts.svg' }, _spec: { svg: 'spec.svg' }, _docker: { svg: 'docker.svg' },
        _src: { svg: 'src.svg' }, _srcOpen: { svg: 'src-open.svg' }, _csharp: { fontCharacter: '\\E009' },
        _cake: { svg: 'cake.svg' },
    },
    fonts: [],
    file: '_file', folder: '_folder', folderExpanded: '_folderOpen',
    fileNames: { dockerfile: '_docker' },
    fileExtensions: { ts: '_ts', 'spec.ts': '_spec', missing: '_nope' },
    folderNames: { src: '_src', test: '_src' },
    folderNamesExpanded: { src: '_srcOpen' },
    languageFileNames: { 'cake.build': '_cake' },
    languageFileExtensions: { cs: '_csharp', ts: '_csharp' },
};

describe('resolveThemeIcon', () => {
    test('file name beats extensions, case-insensitively', () => {
        expect(resolveThemeIcon(theme, 'DockerFile', 'file')).toEqual({ svg: 'docker.svg' });
    });

    test('the longest extension wins and theme extensions beat language extensions', () => {
        expect(resolveThemeIcon(theme, 'user.spec.ts', 'file')).toEqual({ svg: 'spec.svg' });
        expect(resolveThemeIcon(theme, 'user.ts', 'file')).toEqual({ svg: 'ts.svg' });
    });

    test('falls back to the languages, then the default file icon', () => {
        expect(resolveThemeIcon(theme, 'Program.cs', 'file')).toEqual({ fontCharacter: '\\E009' });
        expect(resolveThemeIcon(theme, 'Cake.Build', 'file')).toEqual({ svg: 'cake.svg' });
        expect(resolveThemeIcon(theme, 'README', 'file')).toEqual({ svg: 'file.svg' });
    });

    test('skips associations whose icon is not defined', () => {
        expect(resolveThemeIcon(theme, 'a.missing', 'file')).toEqual({ svg: 'file.svg' });
    });

    test('folders use expanded variants when open', () => {
        expect(resolveThemeIcon(theme, 'Src', 'folder')).toEqual({ svg: 'src.svg' });
        expect(resolveThemeIcon(theme, 'Src', 'folder', true)).toEqual({ svg: 'src-open.svg' });
        expect(resolveThemeIcon(theme, 'test', 'folder', true)).toEqual({ svg: 'src.svg' });
        expect(resolveThemeIcon(theme, 'Models', 'folder')).toEqual({ svg: 'folder.svg' });
        expect(resolveThemeIcon(theme, 'Models', 'folder', true)).toEqual({ svg: 'folder-open.svg' });
    });

    test('no icon without a theme or without default icons', () => {
        expect(resolveThemeIcon(null, 'a.ts', 'file')).toBeUndefined();
        expect(resolveThemeIcon({ ...theme, folder: undefined, folderExpanded: undefined }, 'Models', 'folder')).toBeUndefined();
    });
});

describe('fontGlyph', () => {
    test('turns a CSS escape into the character', () => {
        expect(fontGlyph('\\E009')).toBe(String.fromCodePoint(0xE009));
        expect(fontGlyph('x')).toBe('x');
    });
});
