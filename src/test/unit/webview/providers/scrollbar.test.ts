import { scrollbarCss } from '../../../../webview/providers/views/scrollbar';

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
});
