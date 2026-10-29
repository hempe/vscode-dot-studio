import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { resolveItem, sameFile } from './itemPaths';

/**
 * Linked files (`<Compile Include="..\Shared\x.cs" Link="x.cs" />`): the file lives outside the project folder, the
 * project only points to it. Remove Link takes the item out of the project file; Delete would delete the real file.
 */

/** A wildcard, a list of files, or properties/item lists: what it stands for takes MSBuild to tell */
const isExact = (include: string) => !/[*?;]|[$@]\(/.test(Xml.unescape(include));

interface Element {
    readonly include: string;
    readonly start: number;
    readonly end: number;
}

/** Items of the given types with an Include, self-closing or with children (`<Link>`), outside comments and targets */
function itemElements(content: string, itemTypes: readonly string[]): Element[] {
    const types = itemTypes.map(type => type.replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean);
    if (types.length === 0) {
        return [];
    }
    const elementRe = new RegExp(`<(${types.join('|')})\\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>[\\s\\S]*?<\\/\\1\\s*>)`, 'g');
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[2]);
        if (include && !Xml.inRanges(ignored, match.index!)) {
            result.push({ include: include[1] ?? include[2], start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

/**
 * Removes the items of the project file that list exactly this file (one per item type MSBuild lists it under),
 * with their ItemGroup when it is left empty. `removed` is false when the project file has no such item: the link
 * comes from a wildcard (`LinkBase`), a list, properties, or another file (Directory.Build.props, an import).
 */
export function removeLinkedItem(content: string, projectDir: string, filePath: string, itemTypes: readonly string[]): { content: string; removed: boolean } {
    const matching = itemElements(content, itemTypes)
        .filter(element => isExact(element.include) && sameFile(resolveItem(projectDir, element.include), filePath));
    let result = content;
    // From the end, so the offsets of the earlier items stay valid
    for (const element of [...matching].reverse()) {
        result = Xml.deleteElement(result, element.start, element.end);
    }
    return { content: result, removed: matching.length > 0 };
}

/** The confirmation of Delete on a linked file: the real file goes, for every project that links it */
export function linkedDeleteDetail(filePath: string, projectNames: readonly string[]): string {
    return `This is a linked file: Delete deletes the real file, outside the project:\n${filePath}\n\n`
        + `It is moved to the trash, and ${projectNames.join(', ')} then ${projectNames.length > 1 ? 'list' : 'lists'} a missing file. `
        + 'Remove Link takes it out of the project and leaves the file.';
}

/** The confirmation of Delete on several nodes, some of them linked files */
export function multiDeleteQuestion(count: number, linkedFiles: readonly string[]): string {
    const question = `Delete ${count} items? They are moved to the trash.`;
    if (linkedFiles.length === 0) {
        return question;
    }
    return `${question} ${linkedFiles.length === 1 ? 'One of them is a linked file' : `${linkedFiles.length} of them are linked files`}: `
        + `the real ${linkedFiles.length === 1 ? 'file' : 'files'} outside the project ${linkedFiles.length === 1 ? 'is' : 'are'} deleted `
        + `(${linkedFiles.join(', ')}). To remove only a link, use Remove Link on it.`;
}
