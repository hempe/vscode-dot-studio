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
