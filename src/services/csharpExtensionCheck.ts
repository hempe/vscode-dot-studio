import * as vscode from 'vscode';
import { logger } from '../core/logger';

const log = logger('CSharpExtensionCheck');

/**
 * C# extensions that provide the `coreclr` debugger and the C# language server.
 * Either one works; package.json can't express "one of", so this is checked at runtime.
 */
export const CSHARP_EXTENSIONS = {
    /** Microsoft's, only licensed for Microsoft VS Code (no subscription needed) */
    microsoft: 'ms-dotnettools.csharp',
    /** Open source fork with netcoredbg, available on Open VSX (VSCodium, Cursor, ...) */
    openSource: 'muhammad-sammy.csharp',
} as const;

const DISMISSED_KEY = 'dotnet.csharpExtensionCheck.dismissed';

export function hasCSharpExtension(): boolean {
    return Object.values(CSHARP_EXTENSIONS).some(id => vscode.extensions.getExtension(id) !== undefined);
}

/** The extension to suggest: Microsoft's in VS Code, the open source one in other editors */
export function recommendedCSharpExtension(): string {
    return vscode.env.uriScheme === 'vscode' || vscode.env.uriScheme === 'vscode-insiders'
        ? CSHARP_EXTENSIONS.microsoft
        : CSHARP_EXTENSIONS.openSource;
}

/** Warns (once, until dismissed) when no C# extension is installed and offers to install one */
export async function checkCSharpExtension(context: vscode.ExtensionContext): Promise<void> {
    if (hasCSharpExtension() || context.globalState.get<boolean>(DISMISSED_KEY)) {
        return;
    }

    const id = recommendedCSharpExtension();
    log.info(`No C# extension installed, recommending ${id}`);

    const install = `Install ${id}`;
    const dismiss = "Don't Show Again";
    const choice = await vscode.window.showWarningMessage(
        'A C# extension is needed to debug projects and update namespaces. ' +
        `Install ${CSHARP_EXTENSIONS.microsoft} or ${CSHARP_EXTENSIONS.openSource}.`,
        install,
        dismiss
    );

    if (choice === install) {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
    } else if (choice === dismiss) {
        await context.globalState.update(DISMISSED_KEY, true);
    }
}
