import * as vscode from 'vscode';

let output: vscode.OutputChannel | undefined;

/** The output of service references, WCF and gRPC: svcutil, package installs, downloads */
export function serviceReferencesOutput(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET Studio: Service References');
}

/** An error message with a button to the output */
export async function showServiceReferenceFailure(message: string): Promise<void> {
    if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') {
        serviceReferencesOutput().show();
    }
}
