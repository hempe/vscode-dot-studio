import * as fs from 'fs';
import * as path from 'path';

// Node ids are opaque in the webview: it compares and passes them on, only the extension host reads them
// (NodeIdService). This keeps webview code from depending on what an id contains.
describe('webview code treats node ids as opaque', () => {
    const webview = path.join(__dirname, '../../../../webview');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? (entry.name === 'providers' ? [] : files(path.join(dir, entry.name)))
            : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []);

    it('never imports the id service or decodes ids', () => {
        const offending = files(webview).filter(file => {
            const source = fs.readFileSync(file, 'utf8');
            return /services\/nodeIdService|from 'zlib'|\batob\(|Buffer\.from\(/.test(source);
        }).map(file => path.relative(webview, file));
        expect(offending).toEqual([]);
    });
});
