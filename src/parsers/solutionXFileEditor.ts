/**
 * Text-based editing of .slnx (XML-based) solution files
 *
 * Edits are applied directly to the file content instead of re-serializing the XML,
 * so formatting, comments and unknown elements are preserved.
 *
 * Folders in .slnx are flat; the hierarchy is encoded in the Name ("/src/libs/").
 * Folder paths are passed as segments, e.g. ['src', 'libs'].
 */

// Attribute list that tolerates '>' inside quoted values
const ATTRS = `((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|'[^']*'))*)`;
const FOLDER_RE = () => new RegExp(`<Folder\\b${ATTRS}\\s*(?:\\/>|>([\\s\\S]*?)<\\/Folder\\s*>)`, 'g');
const FILE_RE = () => new RegExp(`<File\\b${ATTRS}\\s*(?:\\/>|>\\s*<\\/File\\s*>)`, 'g');

interface FolderElement {
    start: number;
    end: number;
    attrs: string;
    key: string; // segments joined with '/'
    selfClosing: boolean;
    bodyStart: number;
    bodyEnd: number;
}

export class SolutionXFileEditor {

    static addFolder(content: string, segments: string[]): string {
        segments.forEach(s => this.validateName(s));

        const key = segments.join('/');
        if (this.findFolders(content).some(f => f.key === key)) {
            throw new Error(`Solution folder "${segments[segments.length - 1]}" already exists`);
        }

        return this.ensureFolderElements(content, segments);
    }

    /**
     * Removes the folder and all descendant folders, including the projects and files they contain
     */
    static removeFolder(content: string, segments: string[]): string {
        const targets = this.findFolderAndDescendants(content, segments);

        for (const folder of targets.reverse()) {
            content = this.removeLines(content, folder.start, folder.end);
        }
        return content;
    }

    /**
     * Renames the folder and updates the Name of all descendant folders
     */
    static renameFolder(content: string, segments: string[], newName: string): string {
        this.validateName(newName);

        const key = segments.join('/');
        const newKey = [...segments.slice(0, -1), newName].join('/');
        if (newKey.toLowerCase() !== key.toLowerCase() &&
            this.findFolders(content).some(f => f.key === newKey || f.key.startsWith(newKey + '/'))) {
            throw new Error(`Solution folder "${newName}" already exists`);
        }

        const targets = this.findFolderAndDescendants(content, segments);

        for (const folder of targets.reverse()) {
            const renamedKey = newKey + folder.key.slice(key.length);
            const element = content.slice(folder.start, folder.end);
            const updated = element.replace(
                /(\sName\s*=\s*)("[^"]*"|'[^']*')/,
                (_, prefix) => `${prefix}"${this.escape(`/${renamedKey}/`)}"`
            );
            content = content.slice(0, folder.start) + updated + content.slice(folder.end);
        }
        return content;
    }

    /**
     * Adds a solution item (file) to the folder, creating the folder element if it only exists implicitly
     */
    static addFile(content: string, folderSegments: string[], filePath: string): string {
        content = this.ensureFolderElements(content, folderSegments);

        const key = folderSegments.join('/');
        const folder = this.findFolders(content).find(f => f.key === key)!;
        const normalized = this.normalizePath(filePath);

        const files = this.findFiles(content, folder);
        if (files.some(f => this.normalizePath(f.path) === normalized)) {
            throw new Error(`"${filePath}" is already in solution folder "${folderSegments[folderSegments.length - 1]}"`);
        }

        const nl = this.newline(content);
        const indent = this.lineIndent(content, folder.start);
        const childIndent = indent + this.indentUnit(content);
        const fileElement = `<File Path="${this.escape(filePath)}" />`;

        if (folder.selfClosing) {
            const element = `<Folder${folder.attrs}>${nl}${childIndent}${fileElement}${nl}${indent}</Folder>`;
            return content.slice(0, folder.start) + element + content.slice(folder.end);
        }

        if (files.length > 0) {
            // After the last file
            const insertAt = this.lineEnd(content, files[files.length - 1].end);
            return content.slice(0, insertAt) + `${childIndent}${fileElement}${nl}` + content.slice(insertAt);
        }

        const firstChild = content.indexOf('<', folder.bodyStart);
        if (firstChild !== -1 && firstChild < folder.bodyEnd) {
            // Before the first child (files come before projects)
            const insertAt = this.lineStart(content, firstChild);
            return content.slice(0, insertAt) + `${childIndent}${fileElement}${nl}` + content.slice(insertAt);
        }

        // Empty body: <Folder Name="..."></Folder>
        const element = `<Folder${folder.attrs}>${nl}${childIndent}${fileElement}${nl}${indent}</Folder>`;
        return content.slice(0, folder.start) + element + content.slice(folder.end);
    }

    /**
     * Removes a solution item (file) from every folder containing it; folders left empty become self-closing
     */
    static removeFile(content: string, filePath: string): string {
        const normalized = this.normalizePath(filePath);
        let removed = false;

        for (;;) {
            const folder = this.findFolders(content)
                .find(f => this.findFiles(content, f).some(file => this.normalizePath(file.path) === normalized));
            if (!folder) {
                break;
            }

            const file = this.findFiles(content, folder).find(f => this.normalizePath(f.path) === normalized)!;
            content = this.removeLines(content, file.start, file.end);
            removed = true;

            // Collapse <Folder ...>   </Folder> into <Folder ... />
            const updated = this.findFolders(content).find(f => f.start === folder.start)!;
            if (!/\S/.test(content.slice(updated.bodyStart, updated.bodyEnd))) {
                content = content.slice(0, updated.start) + `<Folder${updated.attrs} />` + content.slice(updated.end);
            }
        }

        if (!removed) {
            throw new Error(`Solution item "${filePath}" not found in solution`);
        }
        return content;
    }

    /**
     * Makes sure the folder and all its ancestors have their own <Folder> element
     */
    private static ensureFolderElements(content: string, segments: string[]): string {
        for (let i = 1; i <= segments.length; i++) {
            const key = segments.slice(0, i).join('/');
            if (!this.findFolders(content).some(f => f.key === key)) {
                content = this.insertFolderElement(content, key);
            }
        }
        return content;
    }

    /**
     * Inserts a <Folder> element, keeping folders sorted by name like the dotnet CLI does
     */
    private static insertFolderElement(content: string, key: string): string {
        const nl = this.newline(content);
        const element = `<Folder Name="${this.escape(`/${key}/`)}" />`;
        const folders = this.findFolders(content);
        const sortKey = (k: string) => `/${k}/`.toLowerCase();

        const next = folders.find(f => sortKey(f.key) > sortKey(key));
        if (next) {
            const insertAt = this.lineStart(content, next.start);
            return content.slice(0, insertAt) + `${this.lineIndent(content, next.start)}${element}${nl}` + content.slice(insertAt);
        }

        if (folders.length > 0) {
            const last = folders[folders.length - 1];
            const insertAt = this.lineEnd(content, last.end);
            return content.slice(0, insertAt) + `${this.lineIndent(content, last.start)}${element}${nl}` + content.slice(insertAt);
        }

        // No folders yet: before the first project, or at the end of the solution
        const firstProject = content.search(/<Project\b/);
        if (firstProject !== -1) {
            const insertAt = this.lineStart(content, firstProject);
            return content.slice(0, insertAt) + `${this.lineIndent(content, firstProject)}${element}${nl}` + content.slice(insertAt);
        }

        const unit = this.indentUnit(content);
        const selfClosing = /<Solution\b[^>]*\/>/.exec(content);
        if (selfClosing) {
            const expanded = selfClosing[0].replace(/\s*\/>$/, '>') + `${nl}${unit}${element}${nl}</Solution>`;
            return content.slice(0, selfClosing.index) + expanded + content.slice(selfClosing.index + selfClosing[0].length);
        }

        const close = content.lastIndexOf('</Solution');
        if (close === -1) {
            throw new Error('Invalid .slnx file: missing <Solution> root element');
        }
        const lineStart = this.lineStart(content, close);
        if (/^[ \t]*$/.test(content.slice(lineStart, close))) {
            return content.slice(0, lineStart) + `${unit}${element}${nl}` + content.slice(lineStart);
        }
        // <Solution></Solution> on a single line
        return content.slice(0, close) + `${nl}${unit}${element}${nl}` + content.slice(close);
    }

    private static findFolderAndDescendants(content: string, segments: string[]): FolderElement[] {
        const key = segments.join('/');
        const targets = this.findFolders(content).filter(f => f.key === key || f.key.startsWith(key + '/'));
        if (targets.length === 0) {
            throw new Error(`Solution folder "${segments[segments.length - 1]}" not found`);
        }
        return targets;
    }

    private static findFolders(content: string): FolderElement[] {
        const folders: FolderElement[] = [];
        const re = FOLDER_RE();
        let match: RegExpExecArray | null;

        while ((match = re.exec(content)) !== null) {
            const name = this.getAttribute(match[1], 'Name');
            if (!name) {
                continue;
            }
            const key = name.split('/').filter(s => s.length > 0).join('/');
            const start = match.index;
            const end = start + match[0].length;
            const selfClosing = match[2] === undefined;

            let bodyStart = end;
            let bodyEnd = end;
            if (!selfClosing) {
                const closingLength = match[0].length - match[0].lastIndexOf('</Folder');
                bodyEnd = end - closingLength;
                bodyStart = bodyEnd - match[2].length;
            }

            folders.push({ start, end, attrs: match[1], key, selfClosing, bodyStart, bodyEnd });
        }
        return folders;
    }

    private static findFiles(content: string, folder: FolderElement): { start: number; end: number; path: string }[] {
        if (folder.selfClosing) {
            return [];
        }

        const body = content.slice(folder.bodyStart, folder.bodyEnd);
        const files: { start: number; end: number; path: string }[] = [];
        const re = FILE_RE();
        let match: RegExpExecArray | null;

        while ((match = re.exec(body)) !== null) {
            const filePath = this.getAttribute(match[1], 'Path');
            if (filePath) {
                const start = folder.bodyStart + match.index;
                files.push({ start, end: start + match[0].length, path: filePath });
            }
        }
        return files;
    }

    private static getAttribute(attrs: string, name: string): string | undefined {
        const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
        if (!match) {
            return undefined;
        }
        return this.unescape(match[1] ?? match[2]);
    }

    private static validateName(name: string): void {
        if (!name || !name.trim() || name.includes('/') || name.includes('\\')) {
            throw new Error(`Invalid solution folder name: "${name}"`);
        }
    }

    /**
     * Removes [start, end) together with its indentation and line break when it is alone on its line
     */
    private static removeLines(content: string, start: number, end: number): string {
        const lineStart = this.lineStart(content, start);
        const ownLine = /^[ \t]*$/.test(content.slice(lineStart, start));
        const after = /^[ \t]*(\r?\n|$)/.exec(content.slice(end));

        if (ownLine && after) {
            return content.slice(0, lineStart) + content.slice(end + after[0].length);
        }
        return content.slice(0, start) + content.slice(end);
    }

    private static lineStart(content: string, index: number): number {
        return content.lastIndexOf('\n', index - 1) + 1;
    }

    /** Index just past the line break following index */
    private static lineEnd(content: string, index: number): number {
        const newline = content.indexOf('\n', index);
        return newline === -1 ? content.length : newline + 1;
    }

    private static lineIndent(content: string, index: number): string {
        return /^[ \t]*/.exec(content.slice(this.lineStart(content, index), index))![0];
    }

    /** Indentation used for children of <Solution>, defaulting to two spaces */
    private static indentUnit(content: string): string {
        const match = /<Solution\b[^>]*>\r?\n([ \t]+)</.exec(content);
        return match ? match[1] : '  ';
    }

    private static newline(content: string): string {
        return content.includes('\r\n') ? '\r\n' : '\n';
    }

    private static normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    private static escape(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private static unescape(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
            .replace(/&amp;/g, '&');
    }
}
