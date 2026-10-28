import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { isWebProject } from '../../parsers/projectKind';
import { escapeMsbuild } from '../projectItems/projectItemEdits';
import { ProtobufItem } from '../projectItems/projectItems';
import { isBelow, resolveItem, sameFile, unescapeMsbuild } from '../projectItems/itemPaths';

/**
 * gRPC references (`<Protobuf>` items) as Visual Studio's "Add Connected Service > gRPC" and `dotnet-grpc` write them:
 * the text edits of the project file, the packages a reference needs, and the helpers of Update. No `vscode` here.
 */

export const GRPC_SERVICES = ['Client', 'Server', 'Both', 'None'] as const;
export type GrpcServices = typeof GRPC_SERVICES[number];

/** Where `dotnet-grpc` puts downloaded files and links files from outside the project */
export const PROTOS_FOLDER = 'Protos';

/** A reference to add: `include` and `link` as they go into the project file (backslashes, MSBuild-escaped) */
export interface NewProtobufReference {
    readonly include: string;
    readonly link?: string;
    readonly services: GrpcServices;
    readonly sourceUrl?: string;
}

/** `dotnet-grpc`'s Default: Both in web projects (`Microsoft.NET.Sdk.Web`), Client elsewhere */
export function defaultGrpcServices(projectXml: string): GrpcServices {
    return isWebProject(projectXml) ? 'Both' : 'Client';
}

/** What the reference generates; Grpc.Tools' default (Both) when the item does not say */
export function servicesOf(item: ProtobufItem): string {
    return item.grpcServices ?? 'Both';
}

/** The tree label of a reference: `greet.proto (Client)` */
export function referenceLabel(item: ProtobufItem): string {
    return `${path.basename(item.fullPath)} (${servicesOf(item)})`;
}


/**
 * The item for a `.proto` file: Include relative to the project folder; a file outside it also gets
 * `Link="Protos\<name>"`, so the tree shows it in Protos (what `dotnet-grpc add-file` writes)
 */
export function protobufReferenceFor(projectDir: string, protoPath: string, services: GrpcServices, sourceUrl?: string): NewProtobufReference {
    const relative = path.relative(projectDir, protoPath);
    const include = escapeMsbuild((path.isAbsolute(relative) ? protoPath : relative).replace(/\//g, '\\'));
    return {
        include,
        ...(isBelow(relative) ? {} : { link: escapeMsbuild(`${PROTOS_FOLDER}\\${path.basename(protoPath)}`) }),
        services,
        ...(sourceUrl ? { sourceUrl } : {}),
    };
}

/** The file an Include (or Link) written in the project file stands for */

interface Element {
    readonly include: string;
    readonly start: number;
    readonly end: number;
}

/** `<Protobuf Include="...">` elements, self-closing or with children, outside comments and targets */
function protobufElements(content: string): Element[] {
    const elementRe = /<Protobuf\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>[\s\S]*?<\/Protobuf\s*>)/g;
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
        if (include && !Xml.inRanges(ignored, match.index!)) {
            result.push({ include: include[1] ?? include[2], start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

/** An Include (as written, XML-escaped) with MSBuild properties or item lists: what it stands for takes MSBuild to tell */
const usesProperties = (include: string) => /[$@]\(/.test(Xml.unescape(include));
/** An Include (as written, XML-escaped) that is a wildcard or a list of files */
const isPattern = (include: string) => /[*?;]/.test(Xml.unescape(include));

/** The element of the project file that lists exactly this file (not a wildcard, not a list, no properties) */
function findElement(content: string, projectDir: string, protoPath: string): Element | undefined {
    return protobufElements(content).find(element => !isPattern(element.include) && !usesProperties(element.include)
        && sameFile(resolveItem(projectDir, element.include), protoPath));
}

/**
 * The `SourceUrl` of the element listing the file, as written in the project file (XML unescaped only). MSBuild's
 * evaluation unescapes `%XX` (`%2B` becomes `+`), and `dotnet-grpc` writes the URL without MSBuild escaping, so the
 * text is what the URL really is. Undefined when no element of the project file lists the file or it has no SourceUrl.
 */
export function sourceUrlInProjectFile(content: string, projectDir: string, protoPath: string): string | undefined {
    const element = findElement(content, projectDir, protoPath);
    if (!element) {
        return undefined;
    }
    const text = content.slice(element.start, element.end);
    const open = text.slice(0, /^<Protobuf\b(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/.exec(text)?.[0].length ?? text.length);
    const attribute = /\bSourceUrl\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(open);
    const child = /<SourceUrl\s*>([^<]*)<\/SourceUrl\s*>/.exec(text.slice(open.length));
    const value = attribute ? attribute[1] ?? attribute[2] : child?.[1];
    return value?.trim() ? Xml.unescape(value.trim()) : undefined;
}

/** The element's lines: self-closing, or with `<SourceUrl>` as a child element (as `dotnet-grpc add-url` writes it) */
function elementLines(reference: NewProtobufReference, indent: string, unit: string): string[] {
    // Both is Grpc.Tools' default: dotnet-grpc leaves the attribute out then
    const attributes = `Include="${Xml.escape(reference.include)}"`
        + (reference.services === 'Both' ? '' : ` GrpcServices="${reference.services}"`)
        + (reference.link ? ` Link="${Xml.escape(reference.link)}"` : '');
    if (!reference.sourceUrl) {
        return [`${indent}<Protobuf ${attributes} />`];
    }
    return [
        `${indent}<Protobuf ${attributes}>`,
        `${indent}${unit}<SourceUrl>${Xml.escape(reference.sourceUrl)}</SourceUrl>`,
        `${indent}</Protobuf>`,
    ];
}

/**
 * Adds the item after the last `<Protobuf>` of the project file (same indentation) that is in an ItemGroup without a
 * Condition and outside Choose/When (there it would count for one framework or configuration only); with only such
 * conditional ones, at the end of the last ItemGroup when that is plain; else (and for a first reference) in a new
 * ItemGroup at the end
 */
export function addProtobufReference(content: string, reference: NewProtobufReference): string {
    const nl = content.includes('\r\n') ? '\r\n' : '\n';
    const unit = Xml.indentUnit(content);
    const elements = protobufElements(content);
    const last = elements.filter(element => Xml.inPlainItemGroup(content, element.start)).pop();
    if (last) {
        const lines = elementLines(reference, Xml.lineIndent(content, last.start), unit);
        return content.slice(0, last.end) + nl + lines.join(nl) + content.slice(last.end);
    }
    if (elements.length > 0) {
        return Xml.appendToLastItemGroup(content, indent => elementLines(reference, indent, unit));
    }
    return Xml.appendItemGroup(content, indent => elementLines(reference, indent, unit));
}

/**
 * Removes the `<Protobuf>` element that lists the file, with its ItemGroup when that is left empty. Returns the content
 * unchanged when no element lists exactly this file (a wildcard, or an item written in another file).
 */
export function removeProtobufReference(content: string, projectDir: string, protoPath: string): string {
    const element = findElement(content, projectDir, protoPath);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** Whether the project references the file already (in its evaluation or, when MSBuild could not tell, in the project file) */
export function isExistingReference(existing: readonly ProtobufItem[], projectXml: string, projectDir: string, protoPath: string): boolean {
    return existing.some(item => sameFile(item.fullPath, protoPath)) || findElement(projectXml, projectDir, protoPath) !== undefined;
}

/**
 * Why a reference to the file must not be added, or undefined: the project has one already (in its evaluation or,
 * when MSBuild could not tell, in the project file), or another reference is shown at the same place (its Link, or
 * for a file in the project, its path)
 */
export function duplicateRefusal(
    existing: readonly ProtobufItem[], projectXml: string, projectDir: string, protoPath: string, reference: NewProtobufReference,
): string | undefined {
    const name = path.basename(protoPath);
    if (isExistingReference(existing, projectXml, projectDir, protoPath)) {
        return `${name} is already a gRPC reference of ${path.basename(projectDir)}.`;
    }
    const shownAs = reference.link ?? reference.include;
    const shownAt = resolveItem(projectDir, shownAs);
    const other = existing.find(item => sameFile(item.link ? resolveItem(projectDir, item.link) : item.fullPath, shownAt));
    if (other) {
        return `${unescapeMsbuild(shownAs)} is already taken by the gRPC reference ${other.include}; rename one of the files.`;
    }
    return undefined;
}

/** Brings Google.Protobuf, Grpc.Tools and the server and client factory packages */
const ASPNETCORE = 'Grpc.AspNetCore';

/**
 * The packages a reference needs that the project does not reference yet. As `dotnet-grpc`: Server and Both take
 * Grpc.AspNetCore; Client takes Google.Protobuf, Grpc.Tools and the client factory (in web projects the one that
 * forwards the server's call context); None only the code generator and its runtime. Unlike `dotnet-grpc`, packages
 * a referenced package brings already are left out.
 */
export function grpcPackages(services: GrpcServices, isWeb: boolean, referenced: readonly string[]): string[] {
    const has = (id: string) => referenced.some(candidate => candidate.toLowerCase() === id.toLowerCase());
    if (has(ASPNETCORE)) {
        return [];
    }
    const wanted = services === 'Server' || services === 'Both' ? [ASPNETCORE]
        : services === 'None' ? ['Google.Protobuf', 'Grpc.Tools']
        : ['Google.Protobuf', isWeb ? 'Grpc.AspNetCore.Server.ClientFactory' : 'Grpc.Net.ClientFactory', 'Grpc.Tools'];
    return wanted.filter(id => !has(id) && !(id === 'Grpc.Net.ClientFactory' && has('Grpc.AspNetCore.Server.ClientFactory')));
}

/**
 * The lowest version a NuGet version range allows: `3.35.1` and `[3.35.1, )` (what a package's dependency says) give
 * `3.35.1`; undefined for a range without a lower bound (`(, 4.0.0)`)
 */
export function rangeMinimum(range: string): string | undefined {
    const lower = range.trim().replace(/^[[(]\s*/, '').split(/[\s,\])]/)[0];
    return lower ? lower : undefined;
}

/**
 * Marks a development dependency (Grpc.Tools) as `dotnet add package` does, so it does not flow to the projects that
 * reference this one. Needed after the Central Package Management edits, which write a bare
 * `<PackageReference Include="Grpc.Tools" />`; nothing changes when the reference has `PrivateAssets` already or is
 * not in the project file.
 */
export function ensureDevelopmentDependency(content: string, id: string): string {
    const elementRe = /<PackageReference\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>[\s\S]*?<\/PackageReference\s*>)/g;
    const ignored = Xml.ignoredRanges(content);
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
        if (!include || Xml.inRanges(ignored, match.index!) || Xml.unescape(include[1] ?? include[2]).trim().toLowerCase() !== id.toLowerCase()) {
            continue;
        }
        if (/\bPrivateAssets\s*=/.test(match[1]) || /<PrivateAssets\b/.test(match[2])) {
            return content;
        }
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const indent = Xml.lineIndent(content, match.index!);
        const child = indent + Xml.indentUnit(content);
        const privateAssets = `${child}<PrivateAssets>all</PrivateAssets>`;
        const start = match.index!;
        const end = start + match[0].length;
        if (match[2] === '/>') {
            const element = [
                `<PackageReference${match[1].replace(/\s+$/, '')}>`,
                `${child}<IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>`,
                privateAssets,
                `${indent}</PackageReference>`,
            ].join(nl);
            return content.slice(0, start) + element + content.slice(end);
        }
        // With children: PrivateAssets goes last, on its own line above the closing tag
        const close = start + match[0].lastIndexOf('</PackageReference');
        const lineStart = content.lastIndexOf('\n', close - 1) + 1;
        return content.slice(lineStart, close).trim() === ''
            ? content.slice(0, lineStart) + privateAssets + nl + content.slice(lineStart)
            : content.slice(0, close) + nl + privateAssets + nl + indent + content.slice(close);
    }
    return content;
}

/** The file name a downloaded `.proto` gets: the URL's last path segment, with `.proto` added when missing */
export function protoFileName(url: string): string {
    let segment = '';
    try {
        const pathname = new URL(url).pathname;
        segment = pathname.slice(pathname.lastIndexOf('/') + 1);
    } catch {
        segment = '';
    }
    try {
        segment = decodeURIComponent(segment);
    } catch {
        // Not valid percent-encoding (`%ZZ`): the name as written
    }
    const name = segment.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'service';
    return /\.proto$/i.test(name) ? name : `${name}.proto`;
}

/**
 * Why a downloaded file is not taken as a `.proto`, or undefined: empty, or HTML (a sign-in or error page served
 * with 200) -- a `.proto` never starts with `<`
 */
export function downloadedContentRefusal(content: Uint8Array): string | undefined {
    const text = Buffer.from(content).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (text === '') {
        return 'the answer was empty';
    }
    if (text.startsWith('<')) {
        return 'it answered with a web page (HTML), not a .proto file (a sign-in page?)';
    }
    return undefined;
}

/** Content hash, to tell whether a downloaded file differs from the local one */
export function contentHash(content: string | Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/** Whether a wildcard Include (as written) matches the file: `*` within a folder, `**` across folders, `?` one character */
function wildcardMatches(projectDir: string, include: string, protoPath: string): boolean {
    return Xml.unescape(include).split(';').some(part => {
        const pattern = resolveItem(projectDir, part).split(path.sep).join('/');
        const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
        return new RegExp(`^${source}$`, process.platform === 'linux' ? '' : 'i').test(protoPath.split(path.sep).join('/'));
    });
}

/**
 * Why Remove cannot take the reference out of the project file, for a file no element lists by itself: a wildcard
 * in the project file, an Include built from MSBuild properties, or an item written in a props file
 */
export function notListedMessage(item: ProtobufItem | undefined, projectPath: string, protoPath: string, projectXml?: string): string {
    const name = path.basename(protoPath);
    if (item?.definedIn && !sameFile(item.definedIn, projectPath)) {
        return `${name} comes from ${path.basename(item.definedIn)}, not from ${path.basename(projectPath)}: remove it there.`;
    }
    const elements = projectXml ? protobufElements(projectXml) : [];
    const projectDir = path.dirname(projectPath);
    const byProperties = elements.find(element => usesProperties(element.include));
    if (byProperties && !elements.some(element => isPattern(element.include) && !usesProperties(element.include)
        && wildcardMatches(projectDir, element.include, protoPath))) {
        return `${name} is listed in ${path.basename(projectPath)} through MSBuild properties (${Xml.unescape(byProperties.include)}): edit the project file.`;
    }
    return `${name} is not listed by itself in ${path.basename(projectPath)} (a wildcard such as Protos\\*.proto includes it): edit the project file.`;
}
