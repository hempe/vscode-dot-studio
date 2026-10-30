/**
 * Scroll bars like VS Code's own: thin, no arrow buttons, a transparent track and a translucent grey thumb in the theme's
 * slider colours (darker on hover and while dragging).
 *
 * VS Code's webview stylesheet sets `scrollbar-color` on the page, and where `scrollbar-color` or `scrollbar-width` is not
 * `auto` Chromium ignores the `::-webkit-scrollbar` rules, so both are reset on the scrolling element first.
 */
export function scrollbarCss(selectors: string | string[]): string {
    return [selectors].flat().map(selector => `
        ${selector} { scrollbar-width: auto; scrollbar-color: auto; }
        ${selector}::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
        ${selector}::-webkit-scrollbar-track,
        ${selector}::-webkit-scrollbar-corner { background: transparent; }
        ${selector}::-webkit-scrollbar-button { display: none; }
        ${selector}::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }
        ${selector}::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
        ${selector}::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground); }`).join('');
}

/** The scroll bars of the whole page: `:root` and everything in it (lists, menus and panels scroll too); these selectors beat the page style's `html` rule */
export const allScrollbarsCss = () => scrollbarCss([':root', ':root *']);

