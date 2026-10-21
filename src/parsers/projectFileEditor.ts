/**
 * Text-based edits of MSBuild project files (.csproj/.vbproj/.fsproj) that preserve the
 * existing formatting and comments.
 */
export class ProjectFileEditor {
    // <Reference ...> element, self-closing or with children; attribute values may contain '>'
    private static readonly REFERENCE_RE = /<Reference\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>[\s\S]*?<\/Reference\s*>)/g;
    private static readonly INCLUDE_RE = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/;

    /**
     * Adds `<Reference Include="name"><HintPath>hintPath</HintPath></Reference>`.
     * Appends after the last existing assembly reference, or in a new ItemGroup at the end of the project.
     * @param assemblyName Simple assembly name (without version/culture/key)
     * @param hintPath Path to the assembly, relative to the project file
     */
    static addAssemblyReference(content: string, assemblyName: string, hintPath: string): string {
        if (!assemblyName.trim()) {
            throw new Error('Invalid assembly name');
        }
        if (this.findAssemblyReferences(content).some(r => r.name.toLowerCase() === assemblyName.toLowerCase())) {
            throw new Error(`'${assemblyName}' is already referenced`);
        }

        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const unit = this.indentUnit(content);
        const element = (indent: string) => [
            `${indent}<Reference Include="${this.escape(assemblyName)}">`,
            `${indent}${unit}<HintPath>${this.escape(hintPath)}</HintPath>`,
            `${indent}</Reference>`,
        ];

        const references = this.findAssemblyReferences(content);
        if (references.length > 0) {
            const last = references[references.length - 1];
            const indent = this.lineIndent(content, last.start);
            return content.slice(0, last.end) + nl + element(indent).join(nl) + content.slice(last.end);
        }

        return this.appendItemGroup(content, element);
    }

    /** Appends a new ItemGroup with `items` before `</Project>`, SDK template style */
    private static appendItemGroup(content: string, items: (indent: string) => string[]): string {
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const unit = this.indentUnit(content);
        const projectEnd = content.lastIndexOf('</Project>');
        if (projectEnd < 0) {
            throw new Error('Invalid project file: missing </Project>');
        }
        const lineStart = content.lastIndexOf('\n', projectEnd - 1) + 1;
        const group = [`${unit}<ItemGroup>`, ...items(unit + unit), `${unit}</ItemGroup>`].join(nl) + nl;

        if (content.slice(lineStart, projectEnd).trim() !== '') {
            // </Project> shares its line with other content
            return content.slice(0, projectEnd) + nl + group + content.slice(projectEnd);
        }

        // Keep an empty line before </Project> (SDK template style) below the new group
        let insertAt = lineStart;
        const previousLineStart = content.lastIndexOf('\n', lineStart - 2) + 1;
        if (lineStart > 0 && content.slice(previousLineStart, lineStart).trim() === '') {
            insertAt = previousLineStart;
        }
        // ...and separate the group from the element above it with an empty line
        const lineAbove = content.slice(content.lastIndexOf('\n', insertAt - 2) + 1, insertAt);
        const separator = /\S/.test(lineAbove) ? nl : '';

        return content.slice(0, insertAt) + separator + group + content.slice(insertAt);
    }

    // Self-closing item element: `<Compile Remove="x" />`; attribute values may contain '>'
    private static readonly ITEM_ELEMENT_RE = /<([A-Za-z]+)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g;

    /** Self-closing items carrying `attribute`, in document order */
    private static findItemElements(content: string, attribute: 'Include' | 'Remove'): { itemType: string; value: string; start: number; end: number }[] {
        const attributeRe = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
        const items: { itemType: string; value: string; start: number; end: number }[] = [];
        for (const match of content.matchAll(this.ITEM_ELEMENT_RE)) {
            const found = attributeRe.exec(match[2]);
            if (found) {
                items.push({
                    itemType: match[1],
                    value: this.unescape(found[1] ?? found[2]),
                    start: match.index!,
                    end: match.index! + match[0].length,
                });
            }
        }
        return items;
    }

    /** `<Compile Remove="path" />`: the file leaves the project (Visual Studio's Exclude From Project) */
    static excludeItem(content: string, itemType: string, relativePath: string): string {
        return this.addItemElement(content, itemType, 'Remove', relativePath);
    }

    /** `<Compile Include="path" />`: puts a file the project does not contain into it */
    static includeItem(content: string, itemType: string, relativePath: string): string {
        return this.addItemElement(content, itemType, 'Include', relativePath);
    }

    private static addItemElement(content: string, itemType: string, attribute: 'Include' | 'Remove', value: string): string {
        const sameType = this.findItemElements(content, attribute).filter(item => item.itemType === itemType);
        if (sameType.some(item => item.value === value)) {
            return content;
        }
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const element = (indent: string) => [`${indent}<${itemType} ${attribute}="${this.escape(value)}" />`];
        const last = sameType[sameType.length - 1];
        if (last) {
            const indent = this.lineIndent(content, last.start);
            return content.slice(0, last.end) + nl + element(indent).join(nl) + content.slice(last.end);
        }
        return this.appendItemGroup(content, element);
    }

    /** Takes `value` out of the `Remove` items; `removed` tells whether there was one */
    static removeRemoveItem(content: string, value: string): { content: string; removed: boolean } {
        const entries = (itemValue: string) => itemValue.split(';').map(entry => entry.trim()).filter(Boolean);
        const matching = this.findItemElements(content, 'Remove').filter(item => entries(item.value).includes(value));
        let result = content;
        // From the end, so the offsets of the earlier items stay valid
        for (const item of matching.reverse()) {
            const rest = entries(item.value).filter(entry => entry !== value);
            if (rest.length > 0) {
                const text = result.slice(item.start, item.end)
                    .replace(/(\bRemove\s*=\s*)(?:"[^"]*"|'[^']*')/, (_all, prefix: string) => `${prefix}"${this.escape(rest.join(';'))}"`);
                result = result.slice(0, item.start) + text + result.slice(item.end);
            } else {
                result = this.deleteElement(result, item.start, item.end);
            }
        }
        return { content: result, removed: matching.length > 0 };
    }

    /** Deletes the element and, when it was alone on its line, the line; an ItemGroup left empty goes too */
    private static deleteElement(content: string, start: number, end: number): string {
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const lineBreak = content.indexOf('\n', end);
        const lineEnd = lineBreak < 0 ? content.length : lineBreak + 1;
        if (content.slice(lineStart, start).trim() !== '' || content.slice(end, lineBreak < 0 ? content.length : lineBreak).trim() !== '') {
            return content.slice(0, start) + content.slice(end);
        }
        let out = content.slice(0, lineStart) + content.slice(lineEnd);

        const previousStart = out.lastIndexOf('\n', lineStart - 2) + 1;
        const nextBreak = out.indexOf('\n', lineStart);
        const previous = out.slice(previousStart, lineStart);
        const next = out.slice(lineStart, nextBreak < 0 ? out.length : nextBreak);
        if (previous.trim() === '<ItemGroup>' && next.trim() === '</ItemGroup>') {
            out = out.slice(0, previousStart) + out.slice(nextBreak < 0 ? out.length : nextBreak + 1);
            // Two empty lines are left where the group was: keep one
            const blankAt = previousStart;
            const blankBreak = out.indexOf('\n', blankAt);
            const lineBefore = out.slice(out.lastIndexOf('\n', blankAt - 2) + 1, blankAt);
            if (out.slice(blankAt, blankBreak < 0 ? out.length : blankBreak).trim() === '' && lineBefore.trim() === '') {
                out = out.slice(0, blankAt) + out.slice(blankBreak < 0 ? out.length : blankBreak + 1);
            }
        }
        return out;
    }

    private static readonly WCF_METADATA_RE = /<WCFMetadata\s+Include\s*=\s*"Connected Services"\s*\/>/;

    /** Adds `<WCFMetadata Include="Connected Services" />`, Visual Studio's marker for service references */
    static ensureWcfMetadata(content: string): string {
        if (this.WCF_METADATA_RE.test(content)) {
            return content;
        }
        return this.appendItemGroup(content, indent => [`${indent}<WCFMetadata Include="Connected Services" />`]);
    }

    /** Removes the WCFMetadata item, with its ItemGroup (and an empty line above it) when nothing else is in it */
    static removeWcfMetadata(content: string): string {
        const match = this.WCF_METADATA_RE.exec(content);
        if (!match) {
            return content;
        }
        const lineStart = (index: number) => content.lastIndexOf('\n', index - 1) + 1;
        const lineEnd = (index: number) => content.indexOf('\n', index) + 1 || content.length;

        let start = lineStart(match.index);
        let end = lineEnd(match.index + match[0].length);
        const groupOpen = content.lastIndexOf('<ItemGroup', match.index);
        const groupClose = content.indexOf('</ItemGroup>', match.index);
        if (groupOpen >= 0 && groupClose >= 0 && content.slice(content.indexOf('>', groupOpen) + 1, groupClose).trim() === match[0]) {
            start = lineStart(groupOpen);
            end = lineEnd(groupClose);
            const previousLine = lineStart(start - 1);
            if (start > 0 && content.slice(previousLine, start).trim() === '') {
                start = previousLine;
            }
        }
        return content.slice(0, start) + content.slice(end);
    }

    /** Assembly references (`<Reference>` items) with the simple name from their Include */
    static findAssemblyReferences(content: string): { name: string; start: number; end: number }[] {
        const result: { name: string; start: number; end: number }[] = [];
        for (const match of content.matchAll(this.REFERENCE_RE)) {
            const include = match[1].match(this.INCLUDE_RE);
            const value = include ? (include[1] ?? include[2]) : '';
            result.push({
                name: this.unescape(value).split(',')[0].trim(),
                start: match.index!,
                end: match.index! + match[0].length,
            });
        }
        return result;
    }

    /** The `<UserSecretsId>` set in the project file itself */
    static userSecretsId(content: string): string | undefined {
        const value = /<UserSecretsId>([^<]*)<\/UserSecretsId>/.exec(content)?.[1].trim();
        return value ? this.unescape(value) : undefined;
    }

    /** Adds `<UserSecretsId>` at the end of the first PropertyGroup, as `dotnet user-secrets init` does */
    static addUserSecretsId(content: string, id: string): string {
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const unit = this.indentUnit(content);
        const element = `<UserSecretsId>${this.escape(id)}</UserSecretsId>`;
        const groupEnd = /<\/PropertyGroup\s*>/.exec(content);
        if (groupEnd) {
            const groupIndent = this.lineIndent(content, groupEnd.index);
            const lineStart = content.lastIndexOf('\n', groupEnd.index - 1) + 1;
            return content.slice(0, lineStart) + groupIndent + unit + element + nl + content.slice(lineStart);
        }
        const projectEnd = content.lastIndexOf('</Project>');
        if (projectEnd < 0) {
            throw new Error('Invalid project file: missing </Project>');
        }
        const lineStart = content.lastIndexOf('\n', projectEnd - 1) + 1;
        const group = [`${unit}<PropertyGroup>`, `${unit}${unit}${element}`, `${unit}</PropertyGroup>`].join(nl) + nl;
        return content.slice(0, lineStart) + group + content.slice(lineStart);
    }

    private static lineIndent(content: string, index: number): string {
        const lineStart = content.lastIndexOf('\n', index - 1) + 1;
        return content.slice(lineStart).match(/^[ \t]*/)![0];
    }

    /** Indentation of the first indented line, two spaces by default (SDK template style) */
    private static indentUnit(content: string): string {
        return content.match(/\n([ \t]+)</)?.[1] ?? '  ';
    }

    private static escape(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private static unescape(value: string): string {
        return value.replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
}
