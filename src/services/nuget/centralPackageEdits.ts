import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';

/**
 * Text edits of `Directory.Packages.props` (and the props files it imports) and of project files for Central
 * Package Management. Like `ProjectFileEditor` they keep formatting, comments and line endings; elements in
 * comments and targets are not touched. Package ids compare case-insensitively, as NuGet does.
 */

/** One change to one file; `file` is the props file or the project file it is applied to */
export type PackageEdit =
    | { readonly kind: 'setPackageVersion' | 'addPackageVersion' | 'setGlobalPackageVersion' | 'setVersionOverride'; readonly file: string; readonly id: string; readonly version: string }
    | { readonly kind: 'removePackageVersion' | 'removeGlobalPackageReference' | 'addPackageReference' | 'removeVersionOverride' | 'addGlobalOptOut' | 'removeGlobalOptOut'; readonly file: string; readonly id: string };

interface Element {
    readonly id: string;
    readonly start: number;
    readonly end: number;
}

/** `<Tag Attribute="id" .../>` or `<Tag Attribute="id">...</Tag>`, outside comments and targets, in document order */
function findElements(content: string, tag: string, attribute: 'Include' | 'Remove' | 'Update' = 'Include'): Element[] {
    const elementRe = new RegExp(`<${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>[\\s\\S]*?<\\/${tag}\\s*>)`, 'g');
    const attributeRe = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const found = attributeRe.exec(match[1]);
        if (found && !Xml.inRanges(ignored, match.index!)) {
            result.push({ id: Xml.unescape(found[1] ?? found[2]).trim(), start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function find(content: string, tag: string, id: string, attribute: 'Include' | 'Remove' = 'Include'): Element | undefined {
    return findElements(content, tag, attribute).find(element => same(element.id, id));
}

function existing(content: string, tag: string, id: string): Element {
    const element = find(content, tag, id);
    if (!element) {
        throw new Error(`No <${tag} Include="${id}"> in the file`);
    }
    return element;
}

const newline = (content: string) => content.includes('\r\n') ? '\r\n' : '\n';

/** Sets `name` on the element: the attribute, or a child element of that name; else a new attribute after Include */
function setMetadata(content: string, element: Element, name: string, value: string): string {
    const text = content.slice(element.start, element.end);
    const attribute = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
    const child = new RegExp(`(<${name}\\s*>)[^<]*(<\\/${name}\\s*>)`);
    const edited = attribute.test(text)
        ? text.replace(attribute, (_all, prefix: string) => `${prefix}"${Xml.escape(value)}"`)
        : child.test(text)
            ? text.replace(child, (_all, open: string, close: string) => `${open}${Xml.escape(value)}${close}`)
            : text.replace(/(\bInclude\s*=\s*(?:"[^"]*"|'[^']*'))/, `$1 ${name}="${Xml.escape(value)}"`);
    return content.slice(0, element.start) + edited + content.slice(element.end);
}

/** Removes the attribute or the child element `name` from the element */
function removeMetadata(content: string, element: Element, name: string): string {
    const text = content.slice(element.start, element.end);
    const edited = text
        .replace(new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '')
        .replace(new RegExp(`\\r?\\n[ \\t]*<${name}\\s*>[^<]*<\\/${name}\\s*>|<${name}\\s*>[^<]*<\\/${name}\\s*>`), '');
    return content.slice(0, element.start) + edited + content.slice(element.end);
}

/**
 * A new element after the last `after` element (same indentation) that is in an ItemGroup without a Condition (an
 * element in a conditional ItemGroup would count only under that condition); else at the end of the last such
 * ItemGroup, else in a new ItemGroup at the end
 */
function insert(content: string, after: readonly Element[], element: string): string {
    const last = after.filter(candidate => Xml.inPlainItemGroup(content, candidate.start)).pop();
    if (last) {
        const indent = Xml.lineIndent(content, last.start);
        return content.slice(0, last.end) + newline(content) + indent + element + content.slice(last.end);
    }
    return Xml.appendToLastItemGroup(content, indent => [indent + element]);
}

const versionElement = (tag: string, id: string, version: string) =>
    `<${tag} Include="${Xml.escape(id)}" Version="${Xml.escape(version)}" />`;

const setsVersion = (content: string, element: Element) =>
    /\sVersion\s*=|<Version\s*>/.test(content.slice(element.start, element.end));

/**
 * The central version of a package (`<PackageVersion Include="id" Version="..." />`). A `<PackageVersion Update="id"
 * Version="..." />` of the file that sets the version too gets the same version: MSBuild applies it over the Include.
 */
export function setPackageVersion(content: string, id: string, version: string): string {
    let edited = setMetadata(content, existing(content, 'PackageVersion', id), 'Version', version);
    // From the end, so the offsets of the elements before stay valid
    for (const update of findElements(edited, 'PackageVersion', 'Update').filter(element => same(element.id, id)).reverse()) {
        if (setsVersion(edited, update)) {
            edited = setMetadata(edited, update, 'Version', version);
        }
    }
    return edited;
}

/** Adds a `PackageVersion` after the last one of the file; nothing when the package has one already */
export function addPackageVersion(content: string, id: string, version: string): string {
    if (find(content, 'PackageVersion', id)) {
        return content;
    }
    return insert(content, findElements(content, 'PackageVersion'), versionElement('PackageVersion', id, version));
}

export function removePackageVersion(content: string, id: string): string {
    const element = find(content, 'PackageVersion', id);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** The version of a `<GlobalPackageReference Include="id" Version="..." />` */
export function setGlobalPackageVersion(content: string, id: string, version: string): string {
    return setMetadata(content, existing(content, 'GlobalPackageReference', id), 'Version', version);
}

export function removeGlobalPackageReference(content: string, id: string): string {
    const element = find(content, 'GlobalPackageReference', id);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** A `PackageReference` without a version (CPM), after the last one of the project file */
export function addPackageReference(content: string, id: string): string {
    if (find(content, 'PackageReference', id)) {
        return content;
    }
    return insert(content, findElements(content, 'PackageReference'), `<PackageReference Include="${Xml.escape(id)}" />`);
}

/** "Set for this project only": the project's own version of a centrally managed package */
export function setVersionOverride(content: string, id: string, version: string): string {
    return setMetadata(content, existing(content, 'PackageReference', id), 'VersionOverride', version);
}

export function removeVersionOverride(content: string, id: string): string {
    const element = find(content, 'PackageReference', id);
    return element ? removeMetadata(content, element, 'VersionOverride') : content;
}

/** `<GlobalPackageReference Remove="id" />`: the project does without a global package */
export function addGlobalOptOut(content: string, id: string): string {
    if (find(content, 'GlobalPackageReference', id, 'Remove')) {
        return content;
    }
    const optOuts = findElements(content, 'GlobalPackageReference', 'Remove');
    return insert(content, optOuts.length > 0 ? optOuts : findElements(content, 'PackageReference'), `<GlobalPackageReference Remove="${Xml.escape(id)}" />`);
}

export function removeGlobalOptOut(content: string, id: string): string {
    const element = find(content, 'GlobalPackageReference', id, 'Remove');
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** The `<GlobalPackageReference Include="id" Version="..." />` entries written in the file (the version as written) */
export function globalPackageReferences(content: string): { id: string; version: string }[] {
    return findElements(content, 'GlobalPackageReference').map(element => {
        const text = content.slice(element.start, element.end);
        const found = /\sVersion\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text) ?? /<Version\s*>([^<]*)<\/Version\s*>/.exec(text);
        return { id: element.id, version: found ? Xml.unescape(found[1] ?? found[2]).trim() : '' };
    });
}

/** Applies one planned edit to the text of its file */
export function applyEdit(content: string, edit: PackageEdit): string {
    switch (edit.kind) {
        case 'setPackageVersion': return setPackageVersion(content, edit.id, edit.version);
        case 'addPackageVersion': return addPackageVersion(content, edit.id, edit.version);
        case 'setGlobalPackageVersion': return setGlobalPackageVersion(content, edit.id, edit.version);
        case 'setVersionOverride': return setVersionOverride(content, edit.id, edit.version);
        case 'removePackageVersion': return removePackageVersion(content, edit.id);
        case 'removeGlobalPackageReference': return removeGlobalPackageReference(content, edit.id);
        case 'addPackageReference': return addPackageReference(content, edit.id);
        case 'removeVersionOverride': return removeVersionOverride(content, edit.id);
        case 'addGlobalOptOut': return addGlobalOptOut(content, edit.id);
        case 'removeGlobalOptOut': return removeGlobalOptOut(content, edit.id);
    }
}
