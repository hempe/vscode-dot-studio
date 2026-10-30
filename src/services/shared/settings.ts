import * as vscode from 'vscode';
import type { FileNestingMode } from '../solution/fileNesting';

/** This extension's settings (package.json `contributes.configuration`, documented in docs/settings.md) */
export const Settings = {
    /** Where a started project's console input and output go: the integrated terminal, a console window of its own, or the Debug Console */
    debugConsole: () => {
        const value = vscode.workspace.getConfiguration('shinobi.debug').get<string>('console', 'integratedTerminal');
        return value === 'externalTerminal' || value === 'internalConsole' ? value : 'integratedTerminal';
    },
    /** Visual Studio's File Nesting button: off, default or web */
    fileNesting: () => vscode.workspace.getConfiguration('shinobi.solutionExplorer').get<FileNestingMode>('fileNesting', 'default'),
    /** Visual Studio's "Track Active Item in Solution Explorer" */
    trackActiveItem: () => vscode.workspace.getConfiguration('shinobi.solutionExplorer').get<boolean>('trackActiveItem', false),
    /** Offer to convert a .sln to .slnx when it opens */
    offerSlnxConversion: () => vscode.workspace.getConfiguration('shinobi.solution').get<boolean>('offerSlnxConversion', true),
    /** Offer to move a solution-level .nuget/NuGet.Config to nuget.config, where dotnet reads it, when the solution opens */
    offerNugetConfigMove: () => vscode.workspace.getConfiguration('shinobi.solution').get<boolean>('offerNugetConfigMove', true),
    /** Builds write the source generators' output (Dependencies > Analyzers) */
    emitGeneratedFiles: () => vscode.workspace.getConfiguration('shinobi.build').get<boolean>('emitGeneratedFiles', true),
    /** Discover tests again after every build */
    discoverTestsAfterBuild: () => vscode.workspace.getConfiguration('shinobi.tests').get<boolean>('discoverAfterBuild', true),
    /** The NuGet manager starts with "Include prerelease" checked */
    /** The NuGet manager manages package sources like Visual Studio (Sources tab) and follows Package Source Mapping */
    nugetPackageSources: () => vscode.workspace.getConfiguration('shinobi.nuget').get<boolean>('packageSources', false),
    nugetIncludePrerelease: () => vscode.workspace.getConfiguration('shinobi.nuget').get<boolean>('includePrerelease', false),
};
