import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../solution/solutionService';
import { ProjectItemsService } from '../project/items/projectItemsService';
import { centralFiles } from './centralPackages';
import { importChain } from './centralPackageFiles';
import { Stamp, changedFiles, watchPlan } from './centralPackageWatch';
import { OwnWrites } from '../shared/ownWrites';

/**
 * Watches the props files the solution's central package versions come from, beyond `Directory.Packages.props`
 * (which the extension's props watcher covers): every file in its import chain (also one that only defines
 * properties used as versions) and every file defining an entry gets a watcher, re-registered whenever an
 * evaluation changes the set and dropped when the solution closes. Files outside the workspace cannot be watched;
 * `recheck` compares their stamps (the NuGet editor calls it when it gets focus).
 */
export class CentralPackageWatchers implements vscode.Disposable {
    private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
    private readonly stamps = new Map<string, Stamp>();
    private readonly subscriptions: { dispose(): void }[];

    /** @param reevaluate evaluates every project of the solution again (what a props change needs) */
    constructor(private readonly reevaluate: () => Promise<void>) {
        this.subscriptions = [
            ProjectItemsService.instance.onDidEvaluate(() => this.update()),
            SolutionService.onDidChangeActiveSolution(() => this.update()),
        ];
    }

    private plan() {
        const projects = [...(SolutionService.getActiveSolution()?.projects.values() ?? [])];
        const evaluated = projects.flatMap(project => ProjectItemsService.instance.packages(project.projectPath) ?? []);
        const propsPaths = new Set(evaluated.flatMap(packages => packages.centrallyManaged && packages.propsPath ? [packages.propsPath] : []));
        const files = [...evaluated.flatMap(centralFiles), ...[...propsPaths].flatMap(importChain)];
        return watchPlan(files, (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
    }

    private update(): void {
        const { watch, outside } = this.plan();
        for (const [file, watcher] of [...this.watchers]) {
            if (!watch.includes(file)) {
                watcher.dispose();
                this.watchers.delete(file);
            }
        }
        for (const file of watch.filter(candidate => !this.watchers.has(candidate))) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file)));
            const changed = (uri: vscode.Uri) => {
                // An edit of the NuGet manager: it evaluates the projects itself, after the restore
                if (!OwnWrites.isOwn(uri.fsPath)) {
                    void this.reevaluate();
                }
            };
            watcher.onDidChange(changed);
            watcher.onDidCreate(changed);
            watcher.onDidDelete(changed);
            this.watchers.set(file, watcher);
        }
        // Remember the stamps of files outside the workspace, so the first focus has something to compare with
        changedFiles(outside.filter(file => !this.stamps.has(file)), this.stamps);
    }

    /** Props files outside the workspace: evaluates again when one changed since the last look */
    async recheck(): Promise<void> {
        if (changedFiles(this.plan().outside, this.stamps).some(file => !OwnWrites.isOwn(file))) {
            await this.reevaluate();
        }
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
    }
}
