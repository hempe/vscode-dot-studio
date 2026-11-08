import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isWebProject } from '../../parsers/projectKind';
import { SolutionService } from '../solution/solutionService';
import { ProjectItems } from '../project/items/projectItems';
import { ProjectItemsService } from '../project/items/projectItemsService';
import { changePackageVersions, OperationsHost, vscodeHost as packageOperationsHost } from '../nuget/centralPackageOperations';
import { PackageBrowseService } from '../nuget/packageBrowseService';
import { PackageOperationResult } from '../nuget/types';
import { VersionUtils } from '../shared/versionUtils';
import { serviceReferencesOutput, showServiceReferenceFailure } from '../serviceReferences/output';
import { Cancellation, download, DownloadCancelled, redactUrl, WebPageAnswer } from './download';
import { sameFile } from '../project/items/itemPaths';
import {
    addProtobufReference, contentHash, defaultGrpcServices, downloadedContentRefusal, duplicateRefusal, ensureDevelopmentDependency, GRPC_SERVICES,
    GrpcServices, grpcPackages, isExistingReference, notListedMessage, protobufReferenceFor, protoFileName, PROTOS_FOLDER, rangeMinimum,
    removeProtobufReference, servicesOf, sourceUrlInProjectFile,
} from './protobufReferences';
import { t } from '../../core/i18n';

export type GrpcSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'url'; readonly url: string };

/** A package a project references, with the version it gets ('' when not known) */
export interface ReferencedPackage {
    readonly id: string;
    readonly version: string;
}

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
    /** The packages the project references (evaluated, so also those from props files); version '' when not known */
    referencedPackages(projectPath: string): Promise<readonly ReferencedPackage[]>;
    /** The newest stable version on the configured package sources */
    latestVersion(id: string): Promise<string | undefined>;
    /** The lowest version of `dependency` that version `version` of package `id` needs; undefined when it needs none (or the sources do not say) */
    dependencyMinimum(id: string, version: string, dependency: string): Promise<string | undefined>;
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
        // A sign-in page sent as text/html: the same refusal as a page that came without that type
        if (error instanceof WebPageAnswer) {
            host.log(`Downloading ${shown}: ${errorText(error)}`);
            host.fail(failed(t('{0} did not send a .proto file ({1})', shown, t('it answered with a web page (HTML), not a .proto file (a sign-in page?)'))));
            return undefined;
        }
        host.log(`Downloading ${shown} failed: ${errorText(error)}`);
        host.fail(failed(t('{0} could not be downloaded', shown)));
        return undefined;
    }
    const refusal = downloadedContentRefusal(content);
    if (refusal) {
        host.log(`Downloading ${shown}: ${refusal}.`);
        host.fail(failed(t('{0} did not send a .proto file ({1})', shown, refusal)));
        return undefined;
    }
    return content;
}

const PACKAGES_FAILED = t('Once the package sources can be reached, add the same reference again: that adds the missing packages.');
const PROTOBUF = 'Google.Protobuf';

/**
 * What adding the packages came to: added, failed (see the output), or kept: the user did not want the project's older
 * Google.Protobuf raised, so nothing was added (`message` says why)
 */
type PackagesOutcome = { readonly kind: 'added' | 'failed' } | { readonly kind: 'kept'; readonly message: string };

/**
 * Add on a file the project references already: adds the packages the reference needs and the project lacks (an Add
 * whose packages failed, e.g. offline, is finished this way); else says it is a reference already
 */
async function completeExistingReference(
    projectPath: string, protoPath: string, services: GrpcServices, refusal: string, projectXml: string, host: GrpcHost,
): Promise<boolean> {
    const name = path.basename(protoPath);
    const referenced = await host.referencedPackages(projectPath);
    const ids = grpcPackages(services, isWebProject(projectXml), referenced.map(entry => entry.id));
    if (ids.length === 0) {
        host.info(refusal);
        return false;
    }
    return host.progress(t('Adding the packages of gRPC reference {0}...', name), async () => {
        host.log(`${name} is a gRPC reference of ${path.basename(projectPath)} already, but ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} missing.`);
        const outcome = await addPackages(projectPath, ids, referenced, host);
        await host.reevaluate(projectPath);
        if (outcome.kind === 'added') {
            host.info(t('{0} was a gRPC reference already; its missing packages were added. The code is generated when the project builds.', name));
        } else if (outcome.kind === 'kept') {
            host.info(t('{0} is a gRPC reference already; its missing packages were not added: {1}', name, outcome.message));
        } else {
            host.fail(t('Adding the packages of gRPC reference {0} failed. {1}', name, PACKAGES_FAILED));
        }
        return outcome.kind === 'added';
    });
}

/**
 * The Google.Protobuf the new packages need when the project references an older one (Grpc.AspNetCore 2.84.0 needs
 * 3.35.1 or newer): restoring would fail with NU1605 (package downgrade). Undefined when nothing needs raising.
 */
async function protobufNeeded(
    packages: readonly { id: string; version: string }[], current: string, host: GrpcHost,
): Promise<{ version: string; by: string } | undefined> {
    let needed: { version: string; by: string } | undefined;
    for (const entry of packages) {
        const minimum = await host.dependencyMinimum(entry.id, entry.version, PROTOBUF);
        if (minimum && VersionUtils.isOutdated(current, minimum) && (!needed || VersionUtils.isOutdated(needed.version, minimum))) {
            needed = { version: minimum, by: `${entry.id} ${entry.version}` };
        }
    }
    return needed;
}

/**
 * Adds the packages the reference needs and the project lacks. A Google.Protobuf of the project older than they need
 * is raised first, to the lowest version they need, after asking (else nothing is added).
 */
async function addPackages(projectPath: string, ids: readonly string[], referenced: readonly ReferencedPackage[], host: GrpcHost): Promise<PackagesOutcome> {
    if (ids.length === 0) {
        return { kind: 'added' };
    }
    const packages: { id: string; version: string }[] = [];
    for (const id of ids) {
        const version = await host.latestVersion(id);
        if (!version) {
            host.log(`${id} was not found on the package sources.`);
            return { kind: 'failed' };
        }
        packages.push({ id, version });
    }
    const project = path.basename(projectPath, path.extname(projectPath));
    const current = referenced.find(entry => entry.id.toLowerCase() === PROTOBUF.toLowerCase())?.version;
    const needed = current ? await protobufNeeded(packages, current, host) : undefined;
    if (current && needed) {
        if (!await host.ask(t('{0} needs {1} {2} or newer; {3} has {4}.', needed.by, PROTOBUF, needed.version, project, current),
            t('Raise {0} to {1}? Restoring the project fails otherwise (NU1605, package downgrade).', PROTOBUF, needed.version), t('Raise to {0}', needed.version))) {
            host.log(`${PROTOBUF} ${current} of ${project} was kept: ${ids.join(', ')} not added.`);
            return {
                kind: 'kept',
                message: t('{0} needs {1} {2} or newer and {3} keeps {4}. Raise {1}, then add the same reference again: that adds the missing packages.',
                    needed.by, PROTOBUF, needed.version, project, current),
            };
        }
        // First: `dotnet add package` restores after each package, and the gRPC one would fail with the old version
        packages.unshift({ id: PROTOBUF, version: needed.version });
    }
    host.log(`Adding ${packages.map(entry => `${entry.id} ${entry.version}`).join(', ')} to ${path.basename(projectPath)}`);
    const results = await host.installPackages(projectPath, packages);
    results.forEach(result => host.log(result.message));
    if (results.some(result => !result.success)) {
        return { kind: 'failed' };
    }
    // Under Central Package Management the reference is written bare: mark Grpc.Tools as dotnet add package does
    if (ids.includes('Grpc.Tools')) {
        const content = fs.readFileSync(projectPath, 'utf8');
        const marked = ensureDevelopmentDependency(content, 'Grpc.Tools');
        if (marked !== content) {
            fs.writeFileSync(projectPath, marked);
        }
    }
    return { kind: 'added' };
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
        downloaded = await downloadProto(sourceUrl, t('Downloading {0}...', path.basename(protoPath)), host,
            reason => t('Adding gRPC reference {0} failed: {1}. Nothing was changed.', path.basename(protoPath), reason));
        if (!downloaded) {
            return false;
        }
        if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) !== contentHash(downloaded)
            && !await host.ask(t('{0} exists already.', relative(projectPath, protoPath)), t('Replace it with the downloaded file?'), t('Replace'))) {
            return false;
        }
    }

    return host.progress(t('Adding gRPC reference {0}...', path.basename(protoPath)), async () => {
        if (downloaded) {
            fs.mkdirSync(path.dirname(protoPath), { recursive: true });
            fs.writeFileSync(protoPath, downloaded);
        }
        fs.writeFileSync(projectPath, addProtobufReference(fs.readFileSync(projectPath, 'utf8'), reference));
        host.log(`Added ${relative(projectPath, protoPath)} (${services}) to ${path.basename(projectPath)}`);
        const referenced = await host.referencedPackages(projectPath);
        const ids = grpcPackages(services, isWebProject(projectXml), referenced.map(entry => entry.id));
        const outcome = await addPackages(projectPath, ids, referenced, host);
        await host.reevaluate(projectPath);
        if (outcome.kind === 'added') {
            host.info(t('gRPC reference {0} added ({1}). The code is generated when the project builds.', path.basename(protoPath), services));
        } else if (outcome.kind === 'kept') {
            host.info(t('gRPC reference {0} added, but not its packages: {1}', path.basename(protoPath), outcome.message));
        } else {
            host.fail(t('gRPC reference {0} added, but adding its packages failed. {1}', path.basename(protoPath), PACKAGES_FAILED));
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
    return outcome.cancelled ? [{ success: false, message: t('Cancelled: the packages were not added.') }] : outcome.results;
}


/**
 * Update of a reference added from a URL (`dotnet-grpc refresh`): downloads it again from its `SourceUrl` and replaces
 * the local file only when the content differs. Returns whether the file changed.
 */
export async function updateGrpcReference(projectPath: string, protoPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const name = path.basename(protoPath);
    const items = await host.items(projectPath);
    if (!items) {
        host.info(t('{0} could not be evaluated by MSBuild (does it build?), so the SourceUrl of {1} is not known.', path.basename(projectPath), name));
        return false;
    }
    const item = items.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
    if (!item?.sourceUrl) {
        host.info(t('{0} was not added from a URL: there is nothing to update it from.', name));
        return false;
    }
    // As written: MSBuild's evaluation unescapes %XX (%2B in a signed URL would become +)
    const sourceUrl = sourceUrlInProjectFile(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath), protoPath) ?? item.sourceUrl;
    const downloaded = await downloadProto(sourceUrl, t('Updating {0}...', name), host, reason => t('Updating {0} failed: {1}. {0} is unchanged.', name, reason));
    if (!downloaded) {
        return false;
    }
    if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) === contentHash(downloaded)) {
        host.info(t('{0} is up to date.', name));
        return false;
    }
    fs.mkdirSync(path.dirname(protoPath), { recursive: true });
    fs.writeFileSync(protoPath, downloaded);
    host.log(`Updated ${relative(projectPath, protoPath)} from ${redactUrl(sourceUrl)}`);
    host.info(t('{0} updated from {1}. The code is generated again when the project builds.', name, redactUrl(sourceUrl)));
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
            host.info(t('{0} could not be evaluated by MSBuild (does it build?), so where {1} comes from is not known: {0} does not list it by itself.', path.basename(projectPath), name));
            return false;
        }
        const item = items.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
        host.info(notListedMessage(item, projectPath, protoPath, projectXml));
        return false;
    }
    if (!await host.ask(t("Remove the gRPC reference '{0}'?", name), t('The <Protobuf> item leaves {0}; {1} and the gRPC packages stay.', path.basename(projectPath), name), t('Remove'))) {
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

const PICK_FILE = t('Browse for .proto File...');
const ENTER_URL = t('Enter URL...');

const SERVICE_DESCRIPTIONS: Record<GrpcServices, string> = {
    Client: t('Client classes to call the services'),
    Server: t('Base classes to implement the services'),
    Both: t('Client and server classes'),
    None: t('Only the message types'),
};

export const vscodeGrpcHost: GrpcHost = {
    pickSource: async () => {
        const choice = await vscode.window.showQuickPick([PICK_FILE, ENTER_URL], { placeHolder: t('Where is the service description (.proto)?') });
        if (choice === PICK_FILE) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: false, openLabel: t('Add gRPC Reference'), filters: { 'Protocol Buffers': ['proto'], [t('All files')]: ['*'] },
            });
            return picked?.[0] ? { kind: 'file', path: picked[0].fsPath } : undefined;
        }
        if (choice === ENTER_URL) {
            const url = await vscode.window.showInputBox({
                prompt: t('Address of the .proto file, e.g. https://raw.githubusercontent.com/.../greet.proto'), ignoreFocusOut: true,
                validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : t('Enter an http(s) URL'),
            });
            return url ? { kind: 'url', url: url.trim() } : undefined;
        }
        return undefined;
    },
    pickServices: async preselected => {
        const order: GrpcServices[] = [preselected, ...(['Client', 'Server', 'Both'] as const).filter(services => services !== preselected)];
        const choice = await vscode.window.showQuickPick(
            order.map(services => ({ label: services, description: SERVICE_DESCRIPTIONS[services], services })),
            { placeHolder: t('What to generate?') });
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
            return packages.references.map(reference => ({ id: reference.id, version: reference.version }));
        }
        // No evaluation: the project file's own references
        return [...fs.readFileSync(projectPath, 'utf8').matchAll(/<PackageReference\b([^>]*)>/gi)].flatMap(match => {
            const id = /\bInclude\s*=\s*"([^"]+)"/i.exec(match[1])?.[1];
            return id ? [{ id, version: /\bVersion\s*=\s*"([^"]*)"/i.exec(match[1])?.[1] ?? '' }] : [];
        });
    },
    latestVersion: async id => {
        const details = await PackageBrowseService.getPackageDetails(id);
        return details ? VersionUtils.findLatest([...(details.versions ?? []), details.currentVersion].filter(Boolean)) ?? undefined : undefined;
    },
    dependencyMinimum: async (id, version, dependency) => {
        const details = await PackageBrowseService.getPackageDetails(id);
        const versionKey = Object.keys(details?.dependencies ?? {}).find(candidate => candidate.toLowerCase() === version.toLowerCase());
        const minimums = (versionKey ? details!.dependencies![versionKey] : [])
            .filter(entry => entry.id.toLowerCase() === dependency.toLowerCase())
            .map(entry => rangeMinimum(entry.range))
            .filter((minimum): minimum is string => !!minimum);
        // Per target framework: the highest (compare sorts newest first)
        return minimums.sort((a, b) => VersionUtils.compare(a, b))[0];
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
