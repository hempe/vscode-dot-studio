/**
 * NuGet's Package Source Mapping (`<packageSourceMapping>` in NuGet.Config): which sources may provide which package ids.
 * Pure functions, no file access: the webview uses them too.
 */

/** Patterns by source name */
export type SourceMapping = Readonly<Record<string, readonly string[]>>;

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/gi, (_all, name: string) => XML_ENTITIES[name.toLowerCase()]);
const attribute = (element: string, name: string) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(element);
    return match ? decode(match[1] ?? match[2]) : undefined;
};

/** The mapping a NuGet.Config declares (comments ignored); empty when it has none */
export function parseSourceMapping(configXml: string): SourceMapping {
    const xml = configXml.replace(/<!--[\s\S]*?-->/g, '');
    const section = /<packageSourceMapping\b[^>]*>([\s\S]*?)<\/packageSourceMapping\s*>/i.exec(xml);
    if (!section) {
        return {};
    }
    const mapping: Record<string, string[]> = {};
    for (const source of section[1].matchAll(/<packageSource\b([^>]*?)(?:\/>|>([\s\S]*?)<\/packageSource\s*>)/gi)) {
        const key = attribute(source[1], 'key');
        if (!key) {
            continue;
        }
        const patterns = [...(source[2] ?? '').matchAll(/<package\b([^>]*?)\/?>/gi)]
            .map(element => attribute(element[1], 'pattern'))
            .filter((pattern): pattern is string => !!pattern);
        mapping[key] = [...(mapping[key] ?? []), ...patterns];
    }
    return mapping;
}

/** The mappings of several NuGet.Config files as NuGet combines them: every pattern of every file */
export function mergeSourceMappings(mappings: readonly SourceMapping[]): SourceMapping {
    const merged: Record<string, string[]> = {};
    for (const mapping of mappings) {
        for (const [source, patterns] of Object.entries(mapping)) {
            const known = Object.keys(merged).find(key => key.toLowerCase() === source.toLowerCase()) ?? source;
            merged[known] = [...new Set([...(merged[known] ?? []), ...patterns])];
        }
    }
    return merged;
}

/** How well a pattern fits a package id: its length when it matches (`*` alone matches everything with length 0), else -1 */
function matchLength(pattern: string, packageId: string): number {
    const id = packageId.toLowerCase();
    const p = pattern.toLowerCase();
    if (p === '*') {
        return 0;
    }
    if (p.endsWith('*')) {
        const prefix = p.slice(0, -1);
        return id.startsWith(prefix) ? prefix.length : -1;
    }
    return id === p ? p.length + 1 : -1;
}

/**
 * The sources the mapping lets provide the package: those with the longest matching pattern (an exact id beats a prefix
 * pattern, a longer prefix a shorter one). `undefined`: the solution has no mapping at all, so any source may; `[]`:
 * there is a mapping and nothing matches the id, so no source may (restore fails with NU1100).
 */
export function mappedSources(mapping: SourceMapping, packageId: string): string[] | undefined {
    const entries = Object.entries(mapping);
    if (entries.length === 0) {
        return undefined;
    }
    let best = -1;
    let sources: string[] = [];
    for (const [source, patterns] of entries) {
        const length = Math.max(-1, ...patterns.map(pattern => matchLength(pattern, packageId)));
        if (length > best) {
            best = length;
            sources = [source];
        } else if (length === best && length >= 0) {
            sources.push(source);
        }
    }
    return best >= 0 ? sources : [];
}
