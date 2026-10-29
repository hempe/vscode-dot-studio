import { logger } from '../../core/logger';

const log = logger('NamespaceSync');

/** The code action the Roslyn server offers on the namespace of a file that does not match its folder */
const CHANGE_NAMESPACE = /^Change namespace to '/;

/** What the sync needs to know about a code action; `edit` is the resolved WorkspaceEdit (opaque here) */
export interface SyncAction {
    title: string;
    edit?: unknown;
    /** Command id; "Fix All: ..." entries are commands (`roslyn.client.fixAllCodeAction`) and never picked */
    command?: string;
}

export interface SyncDeps {
    /** The namespace declaration of the file; `character` is a column inside the name, where the server offers the action */
    parseNamespace(file: string): Promise<{ namespace: string; line: number; character: number } | null>;
    /** The namespace the file's folder asks for (null when unknown) */
    expectedNamespace(file: string): Promise<string | null>;
    /** The code actions at that position, with their edits resolved */
    codeActions(file: string, line: number, character: number): Promise<SyncAction[]>;
    /** Applies the edit of the action and saves every document it touched; false when the edit was refused */
    applyAndSave(action: SyncAction): Promise<boolean>;
}

export interface SyncResult {
    changed: string[];
    unchanged: number;
    failed: Array<{ file: string; reason: string }>;
    cancelled: boolean;
    /** Files whose namespace differs from the one their folder asks for although the server offered no action */
    mismatches: number;
}

function changeNamespaceAction(actions: SyncAction[]): SyncAction | undefined {
    return actions.find(a => CHANGE_NAMESPACE.test(a.title) && !/^Fix All/i.test(a.title) && a.command !== 'roslyn.client.fixAllCodeAction');
}

/**
 * Applies the server's "Change namespace to ..." action to each file, strictly one after the other: the edit also
 * rewrites references in other files, so the next file must be asked after the previous edit is saved
 */
export async function syncNamespaces(
    files: string[],
    deps: SyncDeps,
    token?: { isCancellationRequested: boolean },
    onFile?: (index: number, total: number, file: string) => void
): Promise<SyncResult> {
    const result: SyncResult = { changed: [], unchanged: 0, failed: [], cancelled: false, mismatches: 0 };

    for (const [index, file] of files.entries()) {
        if (token?.isCancellationRequested) {
            result.cancelled = true;
            break;
        }
        onFile?.(index + 1, files.length, file);

        try {
            const declaration = await deps.parseNamespace(file);
            if (!declaration) {
                result.unchanged++;
                continue;
            }

            const action = changeNamespaceAction(await deps.codeActions(file, declaration.line, declaration.character));
            if (!action) {
                result.unchanged++;
                const expected = await deps.expectedNamespace(file);
                if (expected && expected !== declaration.namespace) {
                    log.warn(`${file}: namespace ${declaration.namespace} differs from ${expected}, but the server offers no fix`);
                    result.mismatches++;
                }
                continue;
            }
            if (!action.edit) {
                result.failed.push({ file, reason: 'the language server returned no edit' });
                continue;
            }
            if (!await deps.applyAndSave(action)) {
                result.failed.push({ file, reason: 'the edit could not be applied' });
                continue;
            }

            // asked once more, not looped: an action that stays offered would otherwise never end
            if (changeNamespaceAction(await deps.codeActions(file, declaration.line, declaration.character))) {
                result.failed.push({ file, reason: 'namespace still does not match' });
                continue;
            }
            log.info(`${file}: ${action.title}`);
            result.changed.push(file);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            log.error(`${file}: ${reason}`);
            result.failed.push({ file, reason });
        }
    }
    return result;
}

export const IDE0130_HINT = [
    'dotnet_diagnostic.IDE0130.severity = warning',
    'dotnet_style_namespace_match_folder = true',
];

/** The message after a sync, and whether it offers the details of the failures */
export function syncSummary(result: SyncResult, total: number): { text: string; level: 'info' | 'warning'; details: boolean } {
    const failed = result.failed.length;
    const changed = result.changed.length;
    const done = result.cancelled ? ` (cancelled after ${changed + result.unchanged + failed} of ${total} files)` : '';

    if (changed === 0 && failed === 0) {
        if (result.mismatches > 0) {
            return {
                text: `The language server offered no fix for ${result.mismatches} ${result.mismatches === 1 ? 'file whose namespace differs' : 'files whose namespaces differ'} from their folder. ` +
                    `It only does when IDE0130 is reported: add to .editorconfig "${IDE0130_HINT.join('" and "')}".${done}`,
                level: 'warning',
                details: false,
            };
        }
        return { text: result.cancelled ? `Sync Namespaces cancelled, nothing changed${done}` : 'All namespaces already match', level: 'info', details: false };
    }
    const text = `Synced namespaces in ${changed} of ${total} files` + (failed ? `, ${failed} failed` : '') + done;
    return { text, level: failed ? 'warning' : 'info', details: true };
}
