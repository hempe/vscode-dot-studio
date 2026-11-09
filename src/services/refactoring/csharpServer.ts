import * as vscode from 'vscode';
import { CSHARP_EXTENSIONS } from '../shared/csharpExtensionCheck';
import { logger } from '../../core/logger';

const log = logger('CSharpServer');

/** The part of the C# extension's exports we use (its "experimental" API: requests to the Roslyn language server) */
interface CSharpApi {
    experimental?: { sendServerRequest?<R>(type: { method: string; numberOfParams: number; parameterStructures: string }, params: unknown, token: vscode.CancellationToken): Promise<R> };
}

/**
 * Where the .NET assemblies of ours that the C# extension hands to the server are (package.json: csharpExtensionLoadPaths): the same
 * refactorings built for servers with Roslyn 5.13 or later (a new handler API) and for older ones; the first whose handlers the server knows is used
 */
export const SERVER_EXTENSION_PATHS = ['out/server-extension/roslyn-5.13/Shinobi.Refactorings.dll', 'out/server-extension/Shinobi.Refactorings.dll'];

const ACTIVATE = 'server/_vs_activateExtension';
const DEACTIVATE = 'server/_vs_deactivateExtension';
const DISPATCH_DOCUMENT = 'textDocument/_vs_dispatchExtensionMessage';
// Servers up to Roslyn 5.12 (C# extension 2.160) spell it "dipatch"; 5.13 fixed the name
const DISPATCH_DOCUMENT_OLD = 'textDocument/_vs_dipatchExtensionMessage';
const NO_METHOD = /No method by the name/i;
const NO_HANDLER = /No handler found/i;

const ALREADY_REGISTERED = /already registered/i;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function api(): Promise<CSharpApi | undefined> {
    for (const id of Object.values(CSHARP_EXTENSIONS)) {
        const extension = vscode.extensions.getExtension<CSharpApi>(id);
        if (extension) {
            return extension.isActive ? extension.exports : extension.activate();
        }
    }
    return undefined;
}

/** Messages to the handlers of our assembly in the Roslyn language server of the C# extension */
export class CSharpServer {
    private activated: Promise<unknown> | undefined;
    private dispatchMethod = DISPATCH_DOCUMENT;
    /** The assembly whose handlers the server knows (the one for its Roslyn) */
    private assembly = 0;

    constructor(private readonly assemblyPaths: readonly string[]) {}

    /** True when a C# extension with the server API is installed */
    static async isAvailable(): Promise<boolean> {
        return !!(await api())?.experimental?.sendServerRequest;
    }

    private async send<R>(method: string, params: unknown): Promise<R> {
        const send = (await api())?.experimental?.sendServerRequest;
        if (!send) {
            throw new Error('The C# extension is not available (or too old to send requests to its language server).');
        }
        log.debug(`${method} ${JSON.stringify(params)}`);
        // The extension passes the first argument to vscode-languageclient as it is, which wants a RequestType (a string
        // reads as a request with no method name, and the server dies on the malformed message): its shape is enough
        return send<R>({ method, numberOfParams: 1, parameterStructures: 'byName' }, params, new vscode.CancellationTokenSource().token);
    }

    /**
     * Has the server load our assemblies (the one that is not for its Roslyn may fail). The server refuses a second registration ("is already registered"), which it is
     * when this window forgot it did it (the C# extension kept its server, the registration is gone with a project or solution
     * reload, or two requests raced): that is fine, unless `force` (the handler is not found although it is registered), then
     * the registration is dropped and made again.
     */
    private activate(force = false): Promise<unknown> {
        if (!this.activated || force) {
            this.activated = this.register(force).catch(error => {
                this.activated = undefined;
                throw error;
            });
        }
        return this.activated;
    }

    private async register(force: boolean): Promise<void> {
        const errors: unknown[] = [];
        for (const assemblyFilePath of this.assemblyPaths) {
            try {
                await this.registerOne(assemblyFilePath, force);
            } catch (error) {
                log.debug(`${assemblyFilePath} not activated: ${messageOf(error)}`);
                errors.push(error);
            }
        }
        if (errors.length === this.assemblyPaths.length) {
            throw errors[0];
        }
    }

    private async registerOne(assemblyFilePath: string, force: boolean): Promise<void> {
        const request = { assemblyFilePath };
        try {
            await this.send(ACTIVATE, request);
        } catch (error) {
            if (!ALREADY_REGISTERED.test(messageOf(error))) {
                throw error;
            }
            if (force) {
                await this.send(DEACTIVATE, request);
                await this.send(ACTIVATE, request);
            }
        }
    }

    /** A document message to our handlers, under the name this server knows (the first that does not exist switches to the other) */
    private async dispatch<R>(params: unknown): Promise<R> {
        try {
            return await this.send<R>(this.dispatchMethod, params);
        } catch (error) {
            if (!NO_METHOD.test(messageOf(error))) {
                throw error;
            }
            this.dispatchMethod = this.dispatchMethod === DISPATCH_DOCUMENT ? DISPATCH_DOCUMENT_OLD : DISPATCH_DOCUMENT;
            log.debug(`The server has no ${messageOf(error)}, using ${this.dispatchMethod}`);
            return this.send<R>(this.dispatchMethod, params);
        }
    }

    /** A request of the language server's own protocol (`textDocument/codeAction`, `codeAction/resolve`...) */
    request<R>(method: string, params: unknown): Promise<R> {
        return this.send<R>(method, params);
    }

    /** Asks the assembly that answered last, then the others: the server knows the handlers of the one built for its Roslyn */
    private async dispatchToAssembly<R>(handler: string, params: { textDocument: { uri: string }; message: string }): Promise<R> {
        let lastError: unknown;
        for (let i = 0; i < this.assemblyPaths.length; i++) {
            const index = (this.assembly + i) % this.assemblyPaths.length;
            try {
                const reply = await this.dispatch<R>({ ...params, messageName: handler, assemblyFilePath: this.assemblyPaths[index] });
                if (index !== this.assembly) {
                    log.debug(`The server knows the handlers of ${this.assemblyPaths[index]}`);
                    this.assembly = index;
                }
                return reply;
            } catch (error) {
                if (!NO_HANDLER.test(messageOf(error))) {
                    throw error;
                }
                lastError = error;
            }
        }
        throw lastError;
    }

    /** Runs the handler `handler` (a class of our assembly) on `document` and returns its JSON answer */
    async document<M, R>(document: vscode.Uri, handler: string, message: M): Promise<R | undefined> {
        const dispatch = async () => this.dispatchToAssembly<{ response?: string }>(handler, {
            textDocument: { uri: document.toString() },
            message: JSON.stringify(message),
        });
        await this.activate();
        let reply: { response?: string };
        try {
            reply = await dispatch();
        } catch (error) {
            if (!NO_HANDLER.test(messageOf(error))) {
                throw error;
            }
            // The server restarted since: it has to be told about our assembly again
            log.debug(`${handler} not known to the server, activating the extension again`);
            await this.activate(true);
            reply = await dispatch();
        }
        return reply.response ? JSON.parse(reply.response) as R : undefined;
    }
}
