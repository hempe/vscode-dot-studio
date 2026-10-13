import { IconThemePayload, ThemeIconDefinition } from '../../types/iconTheme';

/**
 * Finds the icon of the user's file icon theme for a file or folder name, with VS Code's precedence:
 * file name, file extensions (longest first), the language's file names and extensions, then the default.
 * Associations whose icon is not defined are skipped. Returns undefined without a theme or default icon.
 * `specificOnly` accepts only file name and extension matches, for nodes that have better built-in icons
 * than the theme's language or default file icon (projects, solutions).
 */
export function resolveThemeIcon(
    theme: IconThemePayload | null | undefined,
    name: string,
    kind: 'file' | 'folder',
    expanded = false,
    specificOnly = false
): ThemeIconDefinition | undefined {
    if (!theme) {
        return undefined;
    }
    const lower = name.toLowerCase();
    const candidates = kind === 'folder'
        ? (expanded
            ? [theme.folderNamesExpanded[lower], theme.folderNames[lower], theme.folderExpanded, theme.folder]
            : [theme.folderNames[lower], theme.folder])
        : [
            theme.fileNames[lower],
            ...extensions(lower).map(extension => theme.fileExtensions[extension]),
            ...(specificOnly ? [] : [
                theme.languageFileNames[lower],
                ...extensions(lower).map(extension => theme.languageFileExtensions[extension]),
                theme.file,
            ]),
        ];

    for (const id of candidates) {
        if (id && theme.icons[id]) {
            return theme.icons[id];
        }
    }
    return undefined;
}

/** `a.spec.ts` → `['spec.ts', 'ts']` */
function extensions(name: string): string[] {
    const parts = name.split('.');
    return parts.slice(1).map((_, index) => parts.slice(index + 1).join('.'));
}

/** Theme files write glyphs as CSS escapes (`\E009`); React needs the character itself */
export function fontGlyph(fontCharacter: string): string {
    const match = /^\\([0-9a-f]+)$/i.exec(fontCharacter);
    return match ? String.fromCodePoint(parseInt(match[1], 16)) : fontCharacter;
}
