import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { sln } from '../../core/utils';
import { shouldSkipDirectory } from '../../core/constants';
import { t } from '../../core/i18n';
import { takePendingOpen } from './pendingOpen';
import { findProjectFiles } from './tempSolution';

/** What the Solution Explorer opens: a solution file, or a temporary solution with these projects */
export type DiscoveredSolution =
    | { kind: 'solution'; solutionPath: string }
    | { kind: 'temporary'; key: string; name: string; projects: string[] };

export interface SolutionDiscoveryResult {
    type: 'none' | 'single' | 'multiple';
    solutionPath?: string;
    availableSolutions?: string[];
}
const SELECTED_KEY = 'shinobi.solution.selected';

export class SolutionDiscovery {
    private static state: vscode.Memento | undefined;
    private static globalState: vscode.Memento | undefined;

    /** Workspace state, where the chosen solution is remembered; global state, where a file opened without a folder waits for its window */
    static initialize(state: vscode.Memento, globalState?: vscode.Memento): void {
        this.state = state;
        this.globalState = globalState;
    }

    /**
     * What to open in the workspace: a file opened without a folder (the window moved to its folder), else the solution as before,
     * else Visual Studio's temporary solution with the projects of the folder, else the offer to open or create one.
     */
    static async discover(workspaceRoots: readonly string[]): Promise<DiscoveredSolution | null> {
        const pending = workspaceRoots[0] && this.globalState ? await takePendingOpen(this.globalState, workspaceRoots[0]) : undefined;
        if (pending && sln(pending)) {
            await this.remember(pending);
            return { kind: 'solution', solutionPath: pending };
        }
        if (pending) {
            return { kind: 'temporary', key: pending, name: path.parse(pending).name, projects: [pending] };
        }
        let none = false;
        const solutionPath = await this.discoverAndSelectSolution(workspaceRoots, async () => { none = true; return null; });
        if (solutionPath) {
            return { kind: 'solution', solutionPath };
        }
        if (!none) {
            return null; // several solutions and none picked
        }
        const projects = (await Promise.all(workspaceRoots.map(root => findProjectFiles(root)))).flat();
        if (projects.length > 0) {
            return { kind: 'temporary', key: workspaceRoots[0], name: path.basename(workspaceRoots[0]), projects };
        }
        return this.offerSolution();
    }

    /** The solution to open next time (chosen from several, or with Open Solution...) */
    static async remember(solutionPath: string): Promise<void> {
        await this.state?.update(SELECTED_KEY, solutionPath);
    }

    /**
     * The solution files of a folder: those directly in it, else those in its subfolders (src/App.sln),
     * up to `maxDepth` folders down, shallow ones first. Build output, dependencies and hidden folders are skipped.
     */
    static async findSolutionFiles(root: string, maxDepth = 3): Promise<string[]> {
        const collected: string[] = [];
        let level = [root];
        for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
            const found: string[] = [];
            const next: string[] = [];
            for (const dir of level) {
                let entries: fs.Dirent[];
                try {
                    entries = await fs.promises.readdir(dir, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const entry of entries) {
                    if (entry.isFile() && sln(entry.name)) {
                        found.push(path.join(dir, entry.name));
                    } else if (entry.isDirectory() && !entry.name.startsWith('.') && !shouldSkipDirectory(entry.name)) {
                        next.push(path.join(dir, entry.name));
                    }
                }
            }
            // The opened folder's own solutions win, like opening a repository root in Visual Studio
            if (depth === 0 && found.length > 0) {
                return found.sort((a, b) => a.localeCompare(b));
            }
            level = next;
            if (depth > 0) {
                collected.push(...found.sort((a, b) => a.localeCompare(b)));
            }
        }
        return collected;
    }

    /**
     * Shows a UI to let user select which solution to open when multiple exist
     */
    static async selectSolution(availableSolutions: string[]): Promise<string | null> {
        const items = availableSolutions.map(solutionPath => ({
            label: path.basename(solutionPath),
            description: path.dirname(solutionPath),
            solutionPath
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('Select a solution to open'),
            title: t('Multiple Solution Files Found')
        });

        return selected?.solutionPath || null;
    }

    /** No solution where the extension looked: offers Open Solution... and Create New Project... */
    static async offerSolution(): Promise<null> {
        const open = t('Open Solution...');
        const create = t('Create New Project...');
        const choice = await vscode.window.showInformationMessage(t('No solution found in this folder or the three folder levels below it.'), open, create);
        if (choice === open) {
            await vscode.commands.executeCommand('shinobi.solution.open');
        } else if (choice === create) {
            await vscode.commands.executeCommand('shinobi.solution.new');
        }
        return null;
    }

    /**
     * Main entry point for solution discovery and selection
     * Returns the path to the solution that should be used
     */
    static async discoverAndSelectSolution(workspaceRoots: string | readonly string[], onNone: () => Promise<null> = () => this.offerSolution()): Promise<string | null> {
        const remembered = this.state?.get<string>(SELECTED_KEY);
        if (remembered && fs.existsSync(remembered)) {
            return remembered;
        }
        // Multi-root workspaces: the solutions of every folder
        const roots = typeof workspaceRoots === 'string' ? [workspaceRoots] : workspaceRoots;
        const found = (await Promise.all(roots.map(root => this.findSolutionFiles(root)))).flat();
        const discovery: SolutionDiscoveryResult = found.length === 0 ? { type: 'none' }
            : found.length === 1 ? { type: 'single', solutionPath: found[0] }
                : { type: 'multiple', availableSolutions: found };

        switch (discovery.type) {
            case 'single':
                return discovery.solutionPath!;

            case 'multiple': {
                const selected = await this.selectSolution(discovery.availableSolutions!);
                if (selected) {
                    await this.remember(selected);
                }
                return selected;
            }

            case 'none':
                return await onNone();

            default:
                return null;
        }
    }
}