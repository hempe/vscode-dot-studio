import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonc } from '../core/jsonc';
import { logger } from '../core/logger';
import { IconThemePayload, ThemeIconDefinition, ThemeIconFont } from '../types/iconTheme';

const log = logger('IconThemeService');

export type ThemeKind = 'dark' | 'light' | 'highContrast';

/** A `contributes.languages` entry of an installed extension */
export interface LanguageContribution {
    readonly id: string;
    readonly extensions?: readonly string[];
    readonly filenames?: readonly string[];
}

type Associations = {
    file?: string;
    folder?: string;
    folderExpanded?: string;
    fileNames?: Record<string, string>;
    fileExtensions?: Record<string, string>;
    folderNames?: Record<string, string>;
    folderNamesExpanded?: Record<string, string>;
    languageIds?: Record<string, string>;
};

/** The parts of a file icon theme JSON file the Solution Explorer uses */
export interface IconThemeFile extends Associations {
    fonts?: { id: string; src: { path: string; format?: string }[]; weight?: string; style?: string; size?: string }[];
    iconDefinitions?: Record<string, { iconPath?: string; fontCharacter?: string; fontColor?: string; fontId?: string; fontSize?: string }>;
    light?: Associations;
    highContrast?: Associations;
}

const lowerKeys = (map: Record<string, string> | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [key.toLowerCase(), value]));

/**
 * Resolves a file icon theme for one colour theme kind into what the webview needs:
 * URIs instead of paths, lower-case keys and `languageIds` resolved through the languages'
 * file names and extensions.
 */
export function buildIconThemePayload(
    theme: IconThemeFile,
    themeDir: string,
    kind: ThemeKind,
    languages: readonly LanguageContribution[],
    toUri: (file: string) => string
): IconThemePayload {
    const override = kind === 'light' ? theme.light : kind === 'highContrast' ? theme.highContrast : undefined;
    const pick = <K extends keyof Associations>(key: K): Associations[K] => override?.[key] ?? theme[key];
    const merged = (key: 'fileNames' | 'fileExtensions' | 'folderNames' | 'folderNamesExpanded' | 'languageIds') =>
        lowerKeys({ ...theme[key], ...override?.[key] });

    const icons: Record<string, ThemeIconDefinition> = {};
    for (const [id, { iconPath, ...glyph }] of Object.entries(theme.iconDefinitions ?? {})) {
        icons[id] = iconPath ? { svg: toUri(path.resolve(themeDir, iconPath)) } : glyph;
    }

    const fonts: ThemeIconFont[] = (theme.fonts ?? []).flatMap(font => font.src.length === 0 ? [] : [{
        id: font.id,
        src: toUri(path.resolve(themeDir, font.src[0].path)),
        format: font.src[0].format,
        weight: font.weight,
        style: font.style,
        size: font.size,
    }]);

    const languageIds = merged('languageIds');
    const languageFileNames: Record<string, string> = {};
    const languageFileExtensions: Record<string, string> = {};
    for (const language of languages) {
        const icon = languageIds[language.id.toLowerCase()];
        if (!icon) {
            continue;
        }
        language.filenames?.forEach(name => languageFileNames[name.toLowerCase()] = icon);
        language.extensions?.forEach(extension => languageFileExtensions[extension.replace(/^\./, '').toLowerCase()] = icon);
    }

    return {
        icons,
        fonts,
        file: pick('file'),
        folder: pick('folder'),
        folderExpanded: pick('folderExpanded'),
        fileNames: merged('fileNames'),
        fileExtensions: merged('fileExtensions'),
        folderNames: merged('folderNames'),
        folderNamesExpanded: merged('folderNamesExpanded'),
        languageFileNames,
        languageFileExtensions,
    };
}

function themeKind(kind: vscode.ColorThemeKind): ThemeKind {
    switch (kind) {
        case vscode.ColorThemeKind.Light: return 'light';
        case vscode.ColorThemeKind.HighContrast:
        case vscode.ColorThemeKind.HighContrastLight: return 'highContrast';
        default: return 'dark';
    }
}

/** Tracks the user's file icon theme (`workbench.iconTheme`) so the webview can draw its icons */
export class IconThemeService implements vscode.Disposable {
    private _theme?: { file: IconThemeFile; dir: string; root: vscode.Uri };
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _disposables: vscode.Disposable[] = [];

    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this._disposables.push(
            this._onDidChange,
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('workbench.iconTheme')) {
                    this._reload();
                }
            }),
            vscode.window.onDidChangeActiveColorTheme(() => this._onDidChange.fire()),
            vscode.extensions.onDidChange(() => this._reload())
        );
        this._load();
    }

    /** Folder of the extension that provides the theme; the webview must be allowed to load from it */
    get themeRoot(): vscode.Uri | undefined {
        return this._theme?.root;
    }

    /** The theme for the current colour theme kind with URIs for `webview`, or null without a theme */
    payloadFor(webview: vscode.Webview): IconThemePayload | null {
        if (!this._theme) {
            return null;
        }
        const languages = vscode.extensions.all.flatMap(extension =>
            (extension.packageJSON?.contributes?.languages ?? []) as LanguageContribution[]);
        return buildIconThemePayload(
            this._theme.file,
            this._theme.dir,
            themeKind(vscode.window.activeColorTheme.kind),
            languages,
            file => webview.asWebviewUri(vscode.Uri.file(file)).toString()
        );
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _reload(): void {
        this._load();
        this._onDidChange.fire();
    }

    private _load(): void {
        this._theme = undefined;
        const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
        if (!id) {
            return;
        }
        for (const extension of vscode.extensions.all) {
            const contribution = (extension.packageJSON?.contributes?.iconThemes as { id: string; path: string }[] | undefined)
                ?.find(theme => theme.id === id);
            if (!contribution) {
                continue;
            }
            const file = path.join(extension.extensionPath, contribution.path);
            try {
                const parsed = parseJsonc(fs.readFileSync(file, 'utf8'));
                if (parsed.value) {
                    this._theme = { file: parsed.value as IconThemeFile, dir: path.dirname(file), root: extension.extensionUri };
                }
            } catch (error) {
                log.warn(`Could not read icon theme ${id} from ${file}:`, error);
            }
            return;
        }
    }
}
