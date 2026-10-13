/** An icon of the user's file icon theme: an SVG (webview URI) or a font glyph */
export interface ThemeIconDefinition {
    readonly svg?: string;
    /** As in the theme file, e.g. `\E003` */
    readonly fontCharacter?: string;
    readonly fontColor?: string;
    readonly fontId?: string;
    readonly fontSize?: string;
}

export interface ThemeIconFont {
    readonly id: string;
    /** Webview URI */
    readonly src: string;
    readonly format?: string;
    readonly weight?: string;
    readonly style?: string;
    readonly size?: string;
}

/** The file icon theme, resolved for the current colour theme kind; all keys are lower case */
export interface IconThemePayload {
    readonly icons: Readonly<Record<string, ThemeIconDefinition>>;
    readonly fonts: readonly ThemeIconFont[];
    readonly file?: string;
    readonly folder?: string;
    readonly folderExpanded?: string;
    readonly fileNames: Readonly<Record<string, string>>;
    readonly fileExtensions: Readonly<Record<string, string>>;
    readonly folderNames: Readonly<Record<string, string>>;
    readonly folderNamesExpanded: Readonly<Record<string, string>>;
    /** `languageIds` resolved through the languages' file names and extensions */
    readonly languageFileNames: Readonly<Record<string, string>>;
    readonly languageFileExtensions: Readonly<Record<string, string>>;
}
