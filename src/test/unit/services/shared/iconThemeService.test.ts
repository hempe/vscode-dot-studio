jest.mock('vscode', () => ({}), { virtual: true });

import * as path from 'path';
import { buildIconThemePayload, LanguageContribution } from '../../../services/iconThemeService';

const themeDir = path.resolve('/ext/icons');
const toUri = (file: string) => `uri:${file}`;

const theme = {
    fonts: [{ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], weight: 'normal', style: 'normal', size: '150%' }],
    iconDefinitions: {
        _cs: { fontCharacter: '\\E009', fontColor: '#519aba' },
        _cs_light: { fontCharacter: '\\E009', fontColor: '#498ba7' },
        _folder: { iconPath: './folder.svg' },
        _src: { iconPath: '../svg/src.svg' },
        _default: { fontCharacter: '\\E023' },
    },
    file: '_default',
    folder: '_folder',
    fileExtensions: { CS: '_cs' },
    fileNames: { 'Dockerfile': '_cs' },
    folderNames: { Src: '_src' },
    languageIds: { csharp: '_cs' },
    light: { fileExtensions: { cs: '_cs_light' }, languageIds: { csharp: '_cs_light' } },
};

const languages: LanguageContribution[] = [
    { id: 'csharp', extensions: ['.cs', '.CSX'], filenames: ['Cake.Build'] },
    { id: 'json' },
];

describe('buildIconThemePayload', () => {
    test('converts icon and font paths to webview URIs and keeps font glyphs', () => {
        const payload = buildIconThemePayload(theme, themeDir, 'dark', languages, toUri);
        expect(payload.icons._folder).toEqual({ svg: `uri:${path.resolve(themeDir, 'folder.svg')}` });
        expect(payload.icons._src.svg).toBe(`uri:${path.resolve('/ext/svg/src.svg')}`);
        expect(payload.icons._cs).toEqual({ fontCharacter: '\\E009', fontColor: '#519aba' });
        expect(payload.fonts).toEqual([{ id: 'seti', src: `uri:${path.resolve(themeDir, 'seti.woff')}`, format: 'woff', weight: 'normal', style: 'normal', size: '150%' }]);
    });

    test('lower-cases association keys and keeps defaults', () => {
        const payload = buildIconThemePayload(theme, themeDir, 'dark', languages, toUri);
        expect(payload.fileExtensions).toEqual({ cs: '_cs' });
        expect(payload.fileNames).toEqual({ dockerfile: '_cs' });
        expect(payload.folderNames).toEqual({ src: '_src' });
        expect(payload.folderNamesExpanded).toEqual({});
        expect([payload.file, payload.folder, payload.folderExpanded]).toEqual(['_default', '_folder', undefined]);
    });

    test('resolves languageIds through the languages\' extensions and file names', () => {
        const payload = buildIconThemePayload(theme, themeDir, 'dark', languages, toUri);
        expect(payload.languageFileExtensions).toEqual({ cs: '_cs', csx: '_cs' });
        expect(payload.languageFileNames).toEqual({ 'cake.build': '_cs' });
    });

    test('merges the light associations over the base for light themes', () => {
        const payload = buildIconThemePayload(theme, themeDir, 'light', languages, toUri);
        expect(payload.fileExtensions).toEqual({ cs: '_cs_light' });
        expect(payload.languageFileExtensions.cs).toBe('_cs_light');
        expect(payload.fileNames).toEqual({ dockerfile: '_cs' });
        expect(payload.folder).toBe('_folder');
    });

    test('high contrast uses the highContrast associations, not the light ones', () => {
        const payload = buildIconThemePayload({ ...theme, highContrast: { file: '_cs' } }, themeDir, 'highContrast', languages, toUri);
        expect(payload.file).toBe('_cs');
        expect(payload.fileExtensions).toEqual({ cs: '_cs' });
    });

    test('tolerates a theme without fonts or associations', () => {
        const payload = buildIconThemePayload({ iconDefinitions: {} }, themeDir, 'dark', [], toUri);
        expect(payload).toEqual({
            icons: {}, fonts: [], file: undefined, folder: undefined, folderExpanded: undefined,
            fileNames: {}, fileExtensions: {}, folderNames: {}, folderNamesExpanded: {},
            languageFileNames: {}, languageFileExtensions: {},
        });
    });
});
