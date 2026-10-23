import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isWebProject } from '../../parsers/projectKind';
import { SolutionService } from '../solutionService';
import { pathKey, ProjectItems } from '../projectItems/projectItems';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { changePackageVersions, OperationsHost, vscodeHost as packageOperationsHost } from '../nuget/centralPackageOperations';
import { PackageBrowseService } from '../nuget/packageBrowseService';
import { PackageOperationResult } from '../nuget/types';
import { VersionUtils } from '../versionUtils';
import { serviceReferencesOutput, showServiceReferenceFailure } from '../serviceReferences/output';
import { Cancellation, download, DownloadCancelled, redactUrl } from './download';
import {
    addProtobufReference, contentHash, defaultGrpcServices, downloadedContentRefusal, duplicateRefusal, ensureDevelopmentDependency, GRPC_SERVICES,
    GrpcServices, grpcPackages, isExistingReference, notListedMessage, protobufReferenceFor, protoFileName, PROTOS_FOLDER, removeProtobufReference,
    servicesOf, sourceUrlInProjectFile,
} from './protobufReferences';

export type GrpcSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'url'; readonly url: string };

/** What adding a gRPC reference needs from VS Code, NuGet and MSBuild; replaced in tests */
export interface GrpcHost {
    pickSource(): Promise<GrpcSource | undefined>;
    /** Client, Server or Both, `preselected` first */
    pickServices(preselected: GrpcServices): Promise<GrpcServices | undefined>;
    /** A modal question with one button besides Cancel: true when it was chosen */
    ask(message: string, detail: string, button: string): Promise<boolean>;
    info(message: string): void;
    /** An error with Show Output */
    fail(message: string): void;
    log(line: string): void;
    /** A progress notification; `cancellable` gives it a Cancel button, whose token the task gets */
    progress<T>(title: string, task: (token?: Cancellation) => Promise<T>, cancellable?: boolean): Promise<T>;
    /** Rejects with DownloadCancelled when `token` is cancelled */
    download(url: string, token?: Cancellation): Promise<Buffer>;
    /** The project's evaluation (its Protobuf items); undefined when MSBuild could not tell */
    items(projectPath: string): Promise<ProjectItems | undefined>;
    /** Ids of the packages the project references (evaluated, so also those from props files) */
    referencedPackages(projectPath: string): Promise<readonly string[]>;
    /** The newest stable version on the configured package sources */
    latestVersion(id: string): Promise<string | undefined>;
    /** Adds the packages, Central Package Management aware */
    installPackages(projectPath: string, packages: readonly { id: string; version: string }[]): Promise<PackageOperationResult[]>;
    /** Evaluates the project again after its file changed (the tree follows) */
    reevaluate(projectPath: string): Promise<void>;
}

const relative = (projectPath: string, file: string) => path.relative(path.dirname(projectPath), file);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Downloads a `.proto` with a cancellable progress notification. Returns the content, or undefined after saying why
 * not (failed, cancelled, or not a `.proto`: an HTML page or nothing); `failed` words the error toast.
 */
async function downloadProto(url: string, title: string, host: GrpcHost, failed: (reason: string) => string): Promise<Buffer | undefined> {
    const shown = redactUrl(url);
    let content: Buffer;
    try {
        content = await host.progress(title, token => host.download(url, token), true);
    } catch (error) {
        if (error instanceof DownloadCancelled) {
            host.log(`Downloading ${shown} was cancelled.`);
            return undefined;
        }
        host.log(`Downloading ${shown} failed: ${errorText(error)}`);
        host.fail(failed(`${shown} could not be downloaded`));
        return undefined;
    }
    const refusal = downloadedContentRefusal(content);
    if (refusal) {
        host.log(`Downloading ${shown}: ${refusal}.`);
        host.fail(failed(`${shown} did not send a .proto file (${refusal})`));
        return undefined;
    }
    return content;
}

const PACKAGES_FAILED = 'Once the package sources can be reached, add the same reference again: that adds the missing packages.';

/**
 * Add on a file the project references already: adds the packages the reference needs and the project lacks (an Add
 * whose packages failed, e.g. offline, is finished this way); else says it is a reference already
 */
async function completeExistingReference(
    projectPath: string, protoPath: string, services: GrpcServices, refusal: string, projectXml: string, host: GrpcHost,
): Promise<boolean> {
    const name = path.basename(protoPath);
    const ids = grpcPackages(services, isWebProject(projectXml), await host.referencedPackages(projectPath));
    if (ids.length === 0) {
        host.info(refusal);
        return false;
    }
    return host.progress(`Adding the packages of gRPC reference ${name}...`, async () => {
        host.log(`${name} is a gRPC reference of ${path.basename(projectPath)} already, but ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} missing.`);
        const added = await addPackages(projectPath, ids, host);
        await host.reevaluate(projectPath);
        if (added) {
            host.info(`${name} was a gRPC reference already; its missing packages were added. The code is generated when the project builds.`);
        } else {
            host.fail(`Adding the packages of gRPC reference ${name} failed. ${PACKAGES_FAILED}`);
        }
        return added;
    });
}

/** Adds the packages the reference needs and the project lacks; false when that failed (see the output) */
async function addPackages(projectPath: string, ids: readonly string[], host: GrpcHost): Promise<boolean> {
    if (ids.length === 0) {
        return true;
    }
    const packages: { id: string; version: string }[] = [];
    for (const id of ids) {
        const version = await host.latestVersion(id);
        if (!version) {
            host.log(`${id} was not found on the package sources.`);
            return false;
        }
        packages.push({ id, version });
    }
    host.log(`Adding ${packages.map(entry => `${entry.id} ${entry.version}`).join(', ')} to ${path.basename(projectPath)}`);
    const results = await host.installPackages(projectPath, packages);
    results.forEach(result => host.log(result.message));
    if (results.some(result => !result.success)) {
        return false;
    }
    // Under Central Package Management the reference is written bare: mark Grpc.Tools as dotnet add package does
    if (ids.includes('Grpc.Tools')) {
        const content = fs.readFileSync(projectPath, 'utf8');
        const marked = ensureDevelopmentDependency(content, 'Grpc.Tools');
        if (marked !== content) {
            fs.writeFileSync(projectPath, marked);
        }
    }
    return true;
}

/**
 * Visual Studio's "Add Connected Service > gRPC" (`dotnet-grpc add-file` / `add-url`): a `.proto` file or a URL (the file
 * is downloaded into Protos/), what to generate, then the `<Protobuf>` item and the packages. Returns whether the
 * reference was added.
 */
export async function addGrpcReference(projectPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const projectDir = path.dirname(projectPath);
    const source = await host.pickSource();
    if (!source) {
        return false;
    }
    const projectXml = fs.readFileSync(projectPath, 'utf8');
    const services = await host.pickServices(defaultGrpcServices(projectXml));
    if (!services) {
        return false;
    }
    const protoPath = source.kind === 'file' ? path.resolve(source.path) : path.join(projectDir, PROTOS_FOLDER, protoFileName(source.url));
    const sourceUrl = source.kind === 'url' ? source.url : undefined;
    const reference = protobufReferenceFor(projectDir, protoPath, services, sourceUrl);
    const existing = (await host.items(projectPath))?.protobuf ?? [];
    const refusal = duplicateRefusal(existing, projectXml, projectDir, protoPath, reference);
    if (refusal) {
        if (isExistingReference(existing, projectXml, projectDir, protoPath)) {
            // What the reference generates decides its packages: the item's, when MSBuild could tell
            const item = existing.find(candidate => sameFile(candidate.fullPath, protoPath));
            const itemServices = item && (GRPC_SERVICES as readonly string[]).find(value => value.toLowerCase() === servicesOf(item).toLowerCase());
            return completeExistingReference(projectPath, protoPath, (itemServices as GrpcServices | undefined) ?? services, refusal, projectXml, host);
        }
        host.info(refusal);
        return false;
    }

    let downloaded: Buffer | undefined;
    if (sourceUrl) {
        downloaded = await downloadProto(sourceUrl, `Downloading ${path.basename(protoPath)}...`, host,
            reason => `Adding gRPC reference ${path.basename(protoPath)} failed: ${reason}. Nothing was changed.`);
        if (!downloaded) {
            return false;
        }
        if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) !== contentHash(downloaded)
            && !await host.ask(`${relative(projectPath, protoPath)} exists already.`, 'Replace it with the downloaded file?', 'Replace')) {
            return false;
        }
    }

    return host.progress(`Adding gRPC reference ${path.basename(protoPath)}...`, async () => {
        if (downloaded) {
            fs.mkdirSync(path.dirname(protoPath), { recursive: true });
            fs.writeFileSync(protoPath, downloaded);
        }
        fs.writeFileSync(projectPath, addProtobufReference(fs.readFileSync(projectPath, 'utf8'), reference));
        host.log(`Added ${relative(projectPath, protoPath)} (${services}) to ${path.basename(projectPath)}`);
        const ids = grpcPackages(services, isWebProject(projectXml), await host.referencedPackages(projectPath));
        const packagesAdded = await addPackages(projectPath, ids, host);
        await host.reevaluate(projectPath);
        if (packagesAdded) {
            host.info(`gRPC reference ${path.basename(protoPath)} added (${services}). The code is generated when the project builds.`);
        } else {
            host.fail(`gRPC reference ${path.basename(protoPath)} added, but adding its packages failed. ${PACKAGES_FAILED}`);
        }
        return true;
    });
}

/**
 * Installs the packages of a gRPC reference through the Central Package Management aware code of the NuGet editor:
 * `PackageVersion`s and bare `PackageReference`s under CPM, `dotnet add package --version` otherwise
 */
export async function installGrpcPackages(
    projectPath: string, packages: readonly { id: string; version: string }[], operations: OperationsHost = packageOperationsHost,
): Promise<PackageOperationResult[]> {
    const outcome = await changePackageVersions(packages.map(entry => ({ id: entry.id, version: entry.version, projects: [projectPath] })), 'shared', operations);
    return outcome.cancelled ? [{ success: false, message: 'Cancelled: the packages were not added.' }] : outcome.results;
}

const sameFile = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));
const notEvaluated = (projectPath: string) => `${path.basename(projectPath)} could not be evaluated by MSBuild (does it build?),`;

/**
 * Update of a reference added from a URL (`dotnet-grpc refresh`): downloads it again from its `SourceUrl` and replaces
 * the local file only when the content differs. Returns whether the file changed.
 */
export async function updateGrpcReference(projectPath: string, protoPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const name = path.basename(protoPath);
    const items = await host.items(projectPath);
    if (!items) {
        host.info(`${notEvaluated(projectPath)} so the SourceUrl of ${name} is not known.`);
        return false;
    }
    const item = items.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
    if (!item?.sourceUrl) {
        host.info(`${name} was not added from a URL: there is nothing to update it from.`);
        return false;
    }
    // As written: MSBuild's evaluation unescapes %XX (%2B in a signed URL would become +)
    const sourceUrl = sourceUrlInProjectFile(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath), protoPath) ?? item.sourceUrl;
    const downloaded = await downloadProto(sourceUrl, `Updating ${name}...`, host, reason => `Updating ${name} failed: ${reason}. ${name} is unchanged.`);
    if (!downloaded) {
        return false;
    }
    if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) === contentHash(downloaded)) {
        host.info(`${name} is up to date.`);
        return false;
    }
    fs.mkdirSync(path.dirname(protoPath), { recursive: true });
    fs.writeFileSync(protoPath, downloaded);
    host.log(`Updated ${relative(projectPath, protoPath)} from ${redactUrl(sourceUrl)}`);
    host.info(`${name} updated from ${redactUrl(sourceUrl)}. The code is generated again when the project builds.`);
    return true;
}

/**
 * Remove (`dotnet-grpc remove`): takes the `<Protobuf>` item out of the project file after asking. The `.proto` file and
 * the packages stay. Refused with a message when the project file does not list the file by itself.
 */
export async function removeGrpcReference(projectPath: string, protoPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const name = path.basename(protoPath);
    const projectDir = path.dirname(projectPath);
    const listed = (content: string) => removeProtobufReference(content, projectDir, protoPath) !== content;
    const projectXml = fs.readFileSync(projectPath, 'utf8');
    if (!listed(projectXml)) {
        const items = await host.items(projectPath);
        if (!items) {
            host.info(`${notEvaluated(projectPath)} so where ${name} comes from is not known: ${path.basename(projectPath)} does not list it by itself.`);
            return false;
        }
        const item = items.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
        host.info(notListedMessage(item, projectPath, protoPath, projectXml));
        return false;
    }
    if (!await host.ask(`Remove the gRPC reference '${name}'?`, `The <Protobuf> item leaves ${path.basename(projectPath)}; ${name} and the gRPC packages stay.`, 'Remove')) {
        return false;
    }
    // Read again: the project file may have changed while the question was open
    const content = fs.readFileSync(projectPath, 'utf8');
    if (!listed(content)) {
        return false;
    }
    fs.writeFileSync(projectPath, removeProtobufReference(content, projectDir, protoPath));
    host.log(`Removed the gRPC reference ${relative(projectPath, protoPath)} from ${path.basename(projectPath)}`);
    await host.reevaluate(projectPath);
    return true;
}

const PICK_FILE = 'Browse for .proto File...';
const ENTER_URL = 'Enter URL...';

const SERVICE_DESCRIPTIONS: Record<GrpcServices, string> = {
    Client: 'Client classes to call the services',
    Server: 'Base classes to implement the services',
    Both: 'Client and server classes',
    None: 'Only the message types',
};

export const vscodeGrpcHost: GrpcHost = {
    pickSource: async () => {
        const choice = await vscode.window.showQuickPick([PICK_FILE, ENTER_URL], { placeHolder: 'Where is the service description (.proto)?' });
        if (choice === PICK_FILE) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: false, openLabel: 'Add gRPC Reference', filters: { 'Protocol Buffers': ['proto'], 'All files': ['*'] },
            });
            return picked?.[0] ? { kind: 'file', path: picked[0].fsPath } : undefined;
        }
        if (choice === ENTER_URL) {
            const url = await vscode.window.showInputBox({
                prompt: 'Address of the .proto file, e.g. https://raw.githubusercontent.com/.../greet.proto', ignoreFocusOut: true,
                validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : 'Enter an http(s) URL',
            });
            return url ? { kind: 'url', url: url.trim() } : undefined;
        }
        return undefined;
    },
    pickServices: async preselected => {
        const order: GrpcServices[] = [preselected, ...(['Client', 'Server', 'Both'] as const).filter(services => services !== preselected)];
        const choice = await vscode.window.showQuickPick(
            order.map(services => ({ label: services, description: SERVICE_DESCRIPTIONS[services], services })),
            { placeHolder: 'What to generate?' });
        return choice?.services;
    },
    ask: async (message, detail, button) => await vscode.window.showWarningMessage(message, { modal: true, detail }, button) === button,
    info: message => void vscode.window.showInformationMessage(message),
    fail: message => void showServiceReferenceFailure(message),
    log: line => serviceReferencesOutput().appendLine(line),
    progress: (title, task, cancellable = false) =>
        Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable }, (_progress, token) => task(token))),
    download: (url, token) => download(url, { token }),
    items: projectPath => ProjectItemsService.instance.evaluate(projectPath),
    referencedPackages: async projectPath => {
        const packages = await ProjectItemsService.instance.evaluatePackages(projectPath);
        if (packages) {
            return packages.references.map(reference => reference.id);
        }
        // No evaluation: the project file's own references
        return [...fs.readFileSync(projectPath, 'utf8').matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)].map(match => match[1]);
    },
    latestVersion: async id => {
        const details = await PackageBrowseService.getPackageDetails(id);
        return details ? VersionUtils.findLatest([...(details.versions ?? []), details.currentVersion].filter(Boolean)) ?? undefined : undefined;
    },
    installPackages: (projectPath, packages) => installGrpcPackages(projectPath, packages),
    reevaluate: async projectPath => {
        const project = SolutionService.getActiveSolution()?.getProject(projectPath);
        if (project) {
            await project.reevaluateItems();
        } else {
            ProjectItemsService.instance.invalidate(projectPath);
            await ProjectItemsService.instance.evaluate(projectPath);
        }
    },
};
