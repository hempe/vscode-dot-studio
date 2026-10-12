import * as path from 'path';

export interface NestedFile {
    name: string;
    path: string;
    children?: NestedFile[];
    isParent?: boolean;
}

type FileEntry = { name: string; path: string };

/** Files whose dependents are named `<file>.<anything>` (Index.cshtml.cs, Counter.razor.css) */
const markupExtensions = ['.razor', '.cshtml', '.vbhtml', '.aspx', '.ascx', '.master', '.xaml'];

/** Generators whose output has the same base name (Model.tt -> Model.cs) */
const generatorExtensions = ['.tt', '.svcmap'];

const codeExtensions = ['.cs', '.vb'];

const suffixPatterns = [
    /\.Dto$/i, /\.Dtos$/i,
    /\.Model$/i, /\.Models$/i,
    /\.Entity$/i, /\.Entities$/i,
    /\.Request$/i, /\.Response$/i,
    /\.Command$/i, /\.Query$/i,
    /\.Validator$/i, /\.Validation$/i,
    /\.Handler$/i, /\.Handlers$/i,
    /\.Service$/i, /\.Services$/i,
    /\.Repository$/i, /\.Repositories$/i,
    /\.Extensions$/i, /\.Extension$/i,
    /\.Helpers$/i, /\.Helper$/i,
    /\.Utils$/i, /\.Util$/i,
    /\.Constants$/i, /\.Constant$/i,
    /\.Config$/i, /\.Configuration$/i,
    /\.Settings$/i, /\.Setting$/i,
    /\.Tests$/i, /\.Test$/i
];

/** Files of one directory, looked up by name */
class Directory {
    private readonly exact = new Map<string, FileEntry>();
    private readonly ignoreCase = new Map<string, FileEntry>();

    add(file: FileEntry): void {
        this.exact.set(file.name, file);
        this.ignoreCase.set(file.name.toLowerCase(), file);
    }

    find(name: string, ignoreCase = false): FileEntry | undefined {
        return ignoreCase ? this.ignoreCase.get(name.toLowerCase()) : this.exact.get(name);
    }
}

export class FileNestingService {

    /**
     * Groups files into nested structure based on naming patterns
     */
    static nestFiles(files: FileEntry[]): NestedFile[] {
        const directories = new Map<string, Directory>();
        for (const file of files) {
            const dir = path.dirname(file.path);
            if (!directories.has(dir)) {
                directories.set(dir, new Directory());
            }
            directories.get(dir)!.add(file);
        }

        const parentOf = new Map<string, string>();
        for (const file of files) {
            const parent = this.findParentFile(file.name, directories.get(path.dirname(file.path))!);
            if (parent && parent.path !== file.path) {
                parentOf.set(file.path, parent.path);
            }
        }

        // A file that would end up nested under itself stays at the root
        for (const file of files) {
            const seen = new Set([file.path]);
            for (let p = parentOf.get(file.path); p; p = parentOf.get(p)) {
                if (seen.has(p)) {
                    parentOf.delete(file.path);
                    break;
                }
                seen.add(p);
            }
        }

        const nodes = new Map<string, NestedFile>();
        for (const file of files) {
            nodes.set(file.path, { name: file.name, path: file.path, children: [] });
        }

        const result: NestedFile[] = [];
        for (const file of files) {
            const node = nodes.get(file.path)!;
            const parentPath = parentOf.get(file.path);
            if (parentPath) {
                const parentNode = nodes.get(parentPath)!;
                parentNode.children!.push(node);
                parentNode.isParent = true;
            } else {
                result.push(node);
            }
        }

        return this.sortNodes(result);
    }

    private static sortNodes(nodes: NestedFile[]): NestedFile[] {
        for (const node of nodes) {
            if (node.children?.length) {
                this.sortNodes(node.children);
            }
        }
        return nodes.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Finds the parent file for a given file based on naming patterns
     */
    private static findParentFile(fileName: string, dir: Directory): FileEntry | null {
        return this.findMarkupParent(fileName, dir)
            ?? this.findDesignerParent(fileName, dir)
            ?? this.findSuffixParent(fileName, dir)
            ?? this.findConfigurationParent(fileName, dir)
            ?? this.findResourceParent(fileName, dir)
            ?? this.findDeclarationParent(fileName, dir)
            ?? this.findGeneratorParent(fileName, dir)
            ?? null;
    }

    /**
     * `<markup file>.<anything>` nests under the markup file
     * (e.g. Index.cshtml.cs, Counter.razor.css, MainWindow.xaml.cs), using the longest matching prefix
     */
    private static findMarkupParent(fileName: string, dir: Directory): FileEntry | undefined {
        const segments = fileName.split('.');
        for (let i = segments.length - 1; i >= 2; i--) {
            const candidate = segments.slice(0, i).join('.');
            if (markupExtensions.includes(path.extname(candidate).toLowerCase())) {
                const parent = dir.find(candidate);
                if (parent) {
                    return parent;
                }
            }
        }
        return undefined;
    }

    /**
     * `X.Designer.cs` nests under X.cs (forms), X.resx (resources), X.settings or X.xsd (datasets)
     */
    private static findDesignerParent(fileName: string, dir: Directory): FileEntry | undefined {
        const match = fileName.match(/^(.+)\.designer(\.cs|\.vb)$/i);
        if (!match) {
            return undefined;
        }
        const [, baseName, ext] = match;
        return [ext, '.resx', '.settings', '.xsd']
            .map(parentExt => dir.find(baseName + parentExt))
            .find(parent => parent !== undefined);
    }

    /**
     * `BaseFile.Suffix.ext` nests under `BaseFile.ext` (e.g. PrinterLayoutCacheEntryProvider.Dtos.cs)
     */
    private static findSuffixParent(fileName: string, dir: Directory): FileEntry | undefined {
        const ext = path.extname(fileName);
        const withoutExt = path.basename(fileName, ext);

        for (const pattern of suffixPatterns) {
            if (pattern.test(withoutExt)) {
                const parent = dir.find(withoutExt.replace(pattern, '') + ext);
                if (parent) {
                    return parent;
                }
            }
        }
        return undefined;
    }

    /**
     * Configuration variants nest under the base file
     * (e.g. appsettings.Development.json -> appsettings.json, app.Debug.config -> app.config)
     */
    private static findConfigurationParent(fileName: string, dir: Directory): FileEntry | undefined {
        const match = fileName.match(/^(.+)\.[^.]+(\.json|\.config)$/i);
        return match ? dir.find(match[1] + match[2], true) : undefined;
    }

    /**
     * `X.resx` nests under its code file `X.cs` (e.g. Form1.resx -> Form1.cs)
     */
    private static findResourceParent(fileName: string, dir: Directory): FileEntry | undefined {
        const match = fileName.match(/^(.+)\.resx$/i);
        if (!match) {
            return undefined;
        }
        return codeExtensions
            .map(ext => dir.find(match[1] + ext))
            .find(parent => parent !== undefined);
    }

    /**
     * TypeScript declarations nest under their source (utils.d.ts -> utils.ts)
     */
    private static findDeclarationParent(fileName: string, dir: Directory): FileEntry | undefined {
        const match = fileName.match(/^(.+)\.d\.ts$/);
        return match ? dir.find(match[1] + '.ts') : undefined;
    }

    /**
     * Generated code nests under its generator (e.g. Model.cs from Model.tt, Reference.cs from Reference.svcmap)
     */
    private static findGeneratorParent(fileName: string, dir: Directory): FileEntry | undefined {
        const ext = path.extname(fileName);
        if (!codeExtensions.includes(ext.toLowerCase())) {
            return undefined;
        }
        const baseName = path.basename(fileName, ext);
        return generatorExtensions
            .map(generatorExt => dir.find(baseName + generatorExt))
            .find(parent => parent !== undefined);
    }
}
