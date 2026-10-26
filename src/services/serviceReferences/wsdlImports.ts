import * as fs from 'fs';
import * as path from 'path';

const LOCATION_RE = /<(?:[\w-]+:)?(?:import|include|redefine)\b[^>]*?\b(?:schemaLocation|location)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * The local files a WSDL or XSD pulls in with `import`, `include` and `redefine` (`schemaLocation`, `location`), followed
 * through the imported files, as paths relative to `root` (the folder of the WSDL). Documents that are URLs, missing or
 * outside `root` are left out: svcutil reports those itself.
 */
export function wsdlImports(file: string, root: string = path.dirname(file)): string[] {
    const found = new Set<string>();
    const visit = (document: string) => {
        let content: string;
        try {
            content = fs.readFileSync(document, 'utf8');
        } catch {
            return;
        }
        for (const match of content.matchAll(LOCATION_RE)) {
            const location = match[1] ?? match[2];
            if (!location || /^[a-z][a-z0-9+.-]*:/i.test(location)) {
                continue; // empty, or a URL
            }
            const target = path.resolve(path.dirname(document), decodeURI(location.replace(/\\/g, '/')));
            const relative = path.relative(root, target);
            if (relative.startsWith('..') || path.isAbsolute(relative) || target === path.resolve(file) || found.has(relative) || !fs.existsSync(target)) {
                continue;
            }
            found.add(relative);
            visit(target);
        }
    };
    visit(file);
    return [...found];
}
