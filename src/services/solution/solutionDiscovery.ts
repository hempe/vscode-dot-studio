import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { sln } from '../../core/utils';
import { shouldSkipDirectory } from '../../core/constants';

export interface SolutionDiscoveryResult {
    type: 'none' | 'single' | 'multiple';
    solutionPath?: string;
    availableSolutions?: string[];
}
const SELECTED_KEY = 'shinobi.solution.selected';

export class SolutionDiscovery {
    private static state: vscode.Memento | undefined;

    /** Workspace state, where the chosen solution is remembered */
    static initialize(state: vscode.Memento): void {
        this.state = state;
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
            placeHolder: 'Select a solution to open',
            title: 'Multiple Solution Files Found'
        });

        return selected?.solutionPath || null;
    }

    /** No solution where the extension looked: offers Open Solution... and Create New Project... */
    static async offerSolution(): Promise<null> {
        const open = 'Open Solution...';
        const create = 'Create New Project...';
        const choice = await vscode.window.showInformationMessage('No solution found in this folder or the three folder levels below it.', open, create);
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
    static async discoverAndSelectSolution(workspaceRoots: string | readonly string[]): Promise<string | null> {
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
                return await this.offerSolution();

            default:
                return null;
        }
    }
}