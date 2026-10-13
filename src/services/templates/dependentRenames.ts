import * as path from 'path';
import { FileNestingService, NestedFile } from '../fileNesting';

/**
 * The files nested under `oldPath` (as the tree shows them) that move along when it is renamed to `newName`:
 * `<old name>.x` becomes `<new name>.x` (Index.cshtml.cs), `<old base>.x` becomes `<new base>.x` (Form1.Designer.cs).
 */
export function dependentRenames(directoryFiles: string[], oldPath: string, newName: string): [string, string][] {
    const find = (nodes: NestedFile[]): NestedFile | undefined => {
        for (const node of nodes) {
            const found = node.path === oldPath ? node : find(node.children ?? []);
            if (found) {
                return found;
            }
        }
        return undefined;
    };
    const descendants = (node: NestedFile): NestedFile[] => (node.children ?? []).flatMap(child => [child, ...descendants(child)]);

    const node = find(FileNestingService.nestFiles(directoryFiles.map(file => ({ name: path.basename(file), path: file }))));
    if (!node) {
        return [];
    }
    const oldName = path.basename(oldPath);
    const oldBase = path.parse(oldName).name;
    const newBase = path.parse(newName).name;

    return descendants(node).flatMap((dependent): [string, string][] => {
        const name = dependent.name;
        const renamed = name.startsWith(`${oldName}.`) ? newName + name.slice(oldName.length)
            : name.startsWith(`${oldBase}.`) ? newBase + name.slice(oldBase.length)
                : undefined;
        return renamed ? [[dependent.path, path.join(path.dirname(dependent.path), renamed)]] : [];
    });
}
