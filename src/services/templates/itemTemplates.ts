import * as path from 'path';
import { DotnetTemplate } from './dotnetNewList';

export type BuiltinItemKind = 'class' | 'interface' | 'record' | 'enum' | 'struct';

/** The basic C# types, written directly: faster than `dotnet new class`, which also misses the folder namespace */
export const BUILTIN_ITEMS: readonly { readonly kind: BuiltinItemKind; readonly label: string; readonly defaultName: string }[] = [
    { kind: 'class', label: 'Class', defaultName: 'Class1.cs' },
    { kind: 'interface', label: 'Interface', defaultName: 'Interface1.cs' },
    { kind: 'record', label: 'Record', defaultName: 'Record1.cs' },
    { kind: 'enum', label: 'Enum', defaultName: 'Enum1.cs' },
    { kind: 'struct', label: 'Struct', defaultName: 'Struct1.cs' },
];

export function builtinItemContent(kind: BuiltinItemKind, name: string, namespace: string, eol = '\n'): string {
    return [`namespace ${namespace};`, '', `public ${kind} ${name}`, '{', '}', ''].join(eol);
}

/** `API Controller` → `APIController1` */
export function defaultTemplateItemName(template: DotnetTemplate): string {
    return `${template.name.replace(/[^A-Za-z0-9]/g, '')}1`;
}

/** The name `dotnet new -n` expects: without a typed extension */
export function itemBaseName(name: string): string {
    return name.replace(/\.[A-Za-z]+$/, '');
}

/** Sets the first namespace declaration, file-scoped or block, to `namespace` */
export function replaceNamespace(content: string, namespace: string): string {
    return content.replace(/^(\s*namespace\s+)[A-Za-z_][\w.]*/m, `$1${namespace}`);
}

/** A folder name as a namespace segment: invalid characters become `_`, a leading digit gets one */
export function namespaceSegment(folderName: string): string {
    const segment = folderName.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[0-9]/.test(segment) ? `_${segment}` : segment;
}

export function projectLanguage(projectPath: string): 'C#' | 'F#' | 'VB' {
    switch (path.extname(projectPath).toLowerCase()) {
        case '.fsproj': return 'F#';
        case '.vbproj': return 'VB';
        default: return 'C#';
    }
}
