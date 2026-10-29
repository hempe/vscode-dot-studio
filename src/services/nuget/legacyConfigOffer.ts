import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { Settings } from '../shared/settings';
import { moveLegacyConfig, needsLegacyConfigMove } from './legacyNugetConfig';

const log = logger('LegacyNuGetConfig');
const DECLINED_KEY = 'shinobi.nugetConfigMove.declined';

/** Where "Don't Ask Again" is remembered: per workspace, per solution folder */
export class LegacyConfigOffer {
    private static state: vscode.Memento | undefined;
    private static readonly shownForFailedRestore = new Set<string>();

    static initialize(state: vscode.Memento): void {
        this.state = state;
    }

    static isDeclined(solutionDir: string): boolean {
        return (this.state?.get<string[]>(DECLINED_KEY, []) ?? []).includes(solutionDir);
    }

    static async decline(solutionDir: string): Promise<void> {
        await this.state?.update(DECLINED_KEY, [...(this.state.get<string[]>(DECLINED_KEY, []) ?? []), solutionDir]);
    }

    /** A failed restore asks once per session and solution */
    static shouldHintAfterFailedRestore(solutionDir: string): boolean {
        if (this.shownForFailedRestore.has(solutionDir)) {
            return false;
        }
        this.shownForFailedRestore.add(solutionDir);
        return true;
    }
}

export interface LegacyConfigOfferDeps {
    ask(message: string, ...buttons: string[]): Promise<string | undefined>;
}

const vscodeDeps: LegacyConfigOfferDeps = {
    ask: (message, ...buttons) => Promise.resolve(vscode.window.showInformationMessage(message, ...buttons)),
};

const HOW = 'Visual Studio reads `.nuget/NuGet.Config`, but `dotnet restore`, `dotnet build` and the other command line tools only read `nuget.config` in the solution folder (or above it) and the user config. ';

/**
 * Offers to put a solution-level `.nuget/NuGet.Config` where `dotnet` reads it. `open`: when the solution opens (setting
 * `shinobi.solution.offerNugetConfigMove`); `restoreFailed`: after a failed restore or build, the likely cause being NU1101
 * (the private feed is not known to the CLI).
 */
export async function offerLegacyConfigMove(solutionPath: string, reason: 'open' | 'restoreFailed', deps: LegacyConfigOfferDeps = vscodeDeps): Promise<void> {
    const solutionDir = path.dirname(solutionPath);
    if (!needsLegacyConfigMove(solutionDir) || LegacyConfigOffer.isDeclined(solutionDir)) {
        return;
    }
    if (reason === 'open' ? !Settings.offerNugetConfigMove() : !LegacyConfigOffer.shouldHintAfterFailedRestore(solutionDir)) {
        return;
    }

    const move = 'Move';
    const copy = 'Copy';
    const notNow = 'Not Now';
    const never = "Don't Ask Again";
    const question = reason === 'open'
        ? `${HOW}Its package sources are unknown to a restore (NU1101 for packages of a private feed). Move it to nuget.config in the solution folder? `
            + 'A script that points at the old path with --configfile would need the new path.'
        : `The restore or build failed. If it is NU1101 or NU1301 for a private feed: ${HOW}Move it to nuget.config in the solution folder?`;
    const choice = await deps.ask(question, move, copy, notNow, never);
    if (choice === never) {
        await LegacyConfigOffer.decline(solutionDir);
        return;
    }
    if (choice !== move && choice !== copy) {
        return;
    }
    try {
        const target = moveLegacyConfig(solutionDir, choice === move ? 'move' : 'copy');
        log.info(`${choice === move ? 'Moved' : 'Copied'} .nuget/NuGet.Config to ${target}`);
        vscode.window.showInformationMessage(`${choice === move ? 'Moved' : 'Copied'} to ${path.basename(target)}. Restore again to use its package sources.`);
    } catch (error) {
        log.error('Moving the NuGet.Config failed:', error);
        vscode.window.showErrorMessage(`Could not ${choice.toLowerCase()} the NuGet.Config: ${error instanceof Error ? error.message : error}`);
    }
}
