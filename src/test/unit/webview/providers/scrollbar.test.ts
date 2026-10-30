import { allScrollbarsCss, scrollbarCss } from '../../../../webview/providers/views/scrollbar';

describe('scrollbarCss', () => {
    const css = scrollbarCss('.tree');

    it('resets scrollbar-color so the ::-webkit-scrollbar rules apply', () => {
        expect(css).toContain('.tree { scrollbar-width: auto; scrollbar-color: auto; }');
    });

    it('has no arrow buttons, a transparent track and a thumb in the theme colours', () => {
        expect(css).toContain('.tree::-webkit-scrollbar-button { display: none; }');
        expect(css).toMatch(/\.tree::-webkit-scrollbar-track,\s*\.tree::-webkit-scrollbar-corner \{ background: transparent; \}/);
        expect(css).toContain('var(--vscode-scrollbarSlider-background)');
        expect(css).toContain('var(--vscode-scrollbarSlider-hoverBackground)');
        expect(css).toContain('var(--vscode-scrollbarSlider-activeBackground)');
    });

    it('covers the whole page for every webview', () => {
        const all = allScrollbarsCss();
        expect(all).toContain(':root { scrollbar-width: auto; scrollbar-color: auto; }');
        expect(all).toContain(':root *::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }');
    });
});
