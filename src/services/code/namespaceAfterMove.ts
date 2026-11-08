import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { NamespaceService } from './namespaceService';
import { t } from '../../core/i18n';

const log = logger('NamespaceAfterMove');

/** A moved C# file whose namespace does not match its new folder */
export interface NamespaceChange {
    readonly filePath: string;
    readonly currentNamespace: string;
    readonly expectedNamespace: string;
}

/**
 * The C# files now at `movedPaths` (a file itself, every `.cs` file under a folder) whose namespace does not match
 * their new place. Files without a namespace (the global one) are left out: there is nothing to rename.
 */
export async function namespaceChangesAfterMove(movedPaths: readonly string[]): Promise<NamespaceChange[]> {
    const files: string[] = [];
    for (const moved of movedPaths) {
        const stat = await fs.promises.stat(moved).catch(() => undefined);
        if (stat?.isDirectory()) {
            files.push(...await NamespaceService.getCSharpFilesInDirectory(moved));
        } else if (stat?.isFile() && moved.endsWith('.cs')) {
            files.push(moved);
        }
    }
    const changes: NamespaceChange[] = [];
    for (const filePath of files) {
        const analysis = await NamespaceService.analyzeNamespaceChanges(filePath);
        if (analysis.needsUpdate && analysis.currentNamespace && analysis.expectedNamespace) {
            changes.push({ filePath, currentNamespace: analysis.currentNamespace, expectedNamespace: analysis.expectedNamespace });
        }
    }
    return changes;
}

const fileQuestion = (operation: string, change: NamespaceChange) =>
    t('{0}: Update namespace in \'{1}\'?\n\nFrom: {2}\nTo: {3}',
        operation, path.basename(change.filePath), change.currentNamespace, change.expectedNamespace);

/**
 * One question for the whole move: Update All, Review Each or Skip; a single file gets the single-file question.
 * Nothing changes without the user's choice.
 */
export async function offerNamespaceUpdates(changes: readonly NamespaceChange[], operation: string): Promise<void> {
    if (changes.length === 0) {
        return;
    }
    try {
        await offerOrUpdate(changes, operation);
    } finally {
        const declarationOnly = NamespaceService.takeDeclarationOnly();
        if (declarationOnly.length > 0) {
            vscode.window.showWarningMessage(t('The namespace was changed in {0} file(s), but the files that use them were not updated: the C# language server\'s "Change namespace" action was not available (it needs the C# extension with the project loaded and IDE0130 reporting in .editorconfig, see Sync Namespaces). Build to find the references.', declarationOnly.length));
        }
    }
}

async function offerOrUpdate(changes: readonly NamespaceChange[], operation: string): Promise<void> {
    if (changes.length === 1) {
        const [change] = changes;
        const choice = await vscode.window.showInformationMessage(fileQuestion(operation, change), { modal: true }, t('Update Namespace'), t('Skip'));
        if (choice === t('Update Namespace')
            && !await NamespaceService.updateNamespaceViaRename(change.filePath, change.currentNamespace, change.expectedNamespace)) {
            vscode.window.showWarningMessage(t('Failed to update namespace in \'{0}\'', path.basename(change.filePath)));
        }
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        t('{0}: {1} C# files have a namespace that does not match their new folder. Update them?', operation, changes.length),
        { modal: true }, t('Update All'), t('Review Each'), t('Skip'));
    if (choice !== t('Update All') && choice !== t('Review Each')) {
        return;
    }
    let updated = 0;
    let skipped = 0;
    for (const change of changes) {
        if (choice === t('Review Each')) {
            const answer = await vscode.window.showInformationMessage(fileQuestion(operation, change), t('Update'), t('Skip'), t('Skip All Remaining'));
            if (answer === t('Skip All Remaining')) {
                skipped = changes.length - updated;
                break;
            }
            if (answer !== t('Update')) {
                skipped++;
                continue;
            }
        }
        if (await NamespaceService.updateNamespaceViaRename(change.filePath, change.currentNamespace, change.expectedNamespace)) {
            updated++;
        } else {
            log.warn(`Failed to update namespace in ${change.filePath}`);
            skipped++;
        }
    }
    vscode.window.showInformationMessage(t('Namespace updates: updated {0} file(s){1}', updated, skipped > 0 ? `, skipped ${skipped}` : ''));
}

/** After a move (not a copy): finds what needs a new namespace and asks once */
export async function updateNamespacesAfterMove(movedPaths: readonly string[], operation: string): Promise<void> {
    try {
        await offerNamespaceUpdates(await namespaceChangesAfterMove(movedPaths), operation);
    } catch (error) {
        log.error('Namespace update after a move failed:', error);
    }
}
