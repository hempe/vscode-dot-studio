# Phase 1.5: File Icon Theme in the Solution Explorer

## Goal

Files and folders in the Solution Explorer webview use the icons of the user's file icon theme (`workbench.iconTheme`), as the native explorer does. `@iconify` stays as the fallback, and keeps drawing nodes that themes don't cover: the solution, projects, solution folders, dependencies, and anything unresolved.

VS Code has no API for this, so the extension reads the theme files itself.

## Extension host: `src/services/iconThemeService.ts`

- **Find the theme.** Look up `workbench.iconTheme` in `vscode.extensions.all` → `packageJSON.contributes.iconThemes[]` by `id`. If the setting is `null` or no extension provides the theme, there is no theme and everything uses the fallback.
- **Read the theme file** with `parseJsonc`, from `<extension>/<iconTheme.path>`.
- **Build the payload** with a pure function, `buildIconThemePayload(theme, themeDir, kind, languages, toUri)`:
  - `kind` is `'dark' | 'light' | 'highContrast'`, from `vscode.window.activeColorTheme.kind`. For light, each association map of `theme.light` (`file`, `folder`, `folderExpanded`, `fileNames`, `fileExtensions`, `folderNames`, `folderNamesExpanded`, `languageIds`) is merged over the base; for high contrast, `theme.highContrast` is merged the same way.
  - `iconDefinitions` become `icons`:
    - `iconPath` turns into a webview URI (`toUri(path.resolve(themeDir, iconPath))`).
    - `fontCharacter`, `fontColor`, `fontId` and `fontSize` are copied.
  - `fonts[]`: each font's first `src` path turns into a webview URI; `weight`, `style` and `size` are kept.
  - All name and extension keys are lower-cased; VS Code matches them case-insensitively.
  - `languageIds` are resolved into `languageFileNames` and `languageFileExtensions`. These maps go from a file name or extension to an icon id, through every installed extension's `contributes.languages[].filenames` and `.extensions`, which include built-ins such as `csharp`.
- **Payload** (`src/types/iconTheme.ts`, browser-safe):

```ts
interface IconThemePayload {
    icons: Record<string, { svg?: string; fontCharacter?: string; fontColor?: string; fontId?: string; fontSize?: string }>;
    fonts: { id: string; src: string; format?: string; weight?: string; style?: string; size?: string }[];
    file?: string; folder?: string; folderExpanded?: string;
    fileNames: Record<string, string>; fileExtensions: Record<string, string>;
    folderNames: Record<string, string>; folderNamesExpanded: Record<string, string>;
    languageFileNames: Record<string, string>; languageFileExtensions: Record<string, string>;
}
```

- **Service:**
  - Rebuilds the payload when `workbench.iconTheme` changes, when the colour theme kind changes, or when extensions change.
  - Fires `onDidChange`.
  - Exposes `themeRoot`, the theme extension's folder, so the provider can allow the webview to load from it.

## Messaging

- UI message `iconTheme` with payload `{ theme: IconThemePayload | null }`.
- The provider:
  - Sends it after `solutionData` the first time, and whenever the service changes.
  - Adds `themeRoot` to `localResourceRoots`, updating `webview.options` on change.
  - Adds `img-src ${webview.cspSource}` to the CSP.

## Webview

- `src/webview/shared/iconTheme.ts` holds a pure `resolveThemeIcon(theme, name, kind: 'file' | 'folder', expanded)`, which follows VS Code's precedence:
  - **file:**
    1. `fileNames[name]`
    2. `fileExtensions` for each dotted suffix, longest first (`a.spec.ts` → `spec.ts`, then `ts`)
    3. `languageFileNames[name]`
    4. `languageFileExtensions` for each suffix
    5. `file`
  - **folder:** if `expanded`, `folderNamesExpanded[name]`, then `folderExpanded`. Otherwise `folderNames[name]`, then `folder`. When expanded with no expanded mapping, use the collapsed name mapping before the defaults.
  - It returns the icon definition, or `undefined` if no theme is set or the id has no definition.
- An `IconThemeContext` React context carries the payload. `App` provides it and renders one `@font-face` per theme font.
- `TreeNode` asks the resolver first for `file` and `solutionItem` nodes (kind file) and for `folder` and `solutionFolder` nodes (kind folder):
  - An SVG definition renders `<img src>` at 16×16.
  - A font definition renders a `<span>` with the theme font family, the character (`\E009` → `String.fromCodePoint(0xE009)`), `fontColor` and `fontSize`.
  - Otherwise the current `@iconify` icon renders.

## Testing

- `buildIconThemePayload`:
  - light and high-contrast merging
  - URI conversion for icons and fonts
  - lower-cased keys
  - language mapping
- `resolveThemeIcon`:
  - precedence order
  - the longest suffix wins
  - case-insensitive matching
  - expanded folders
  - undefined without a theme or definition
- `TreeNode`:
  - an SVG theme icon renders an `<img>`
  - a font icon renders the character
  - without a theme, the iconify fallback renders

## Out of scope

- `rootFolderNames`, `hidesExplorerArrows`, and themes that ship their associations through other contribution points
- Product icon themes, which replace codicons
