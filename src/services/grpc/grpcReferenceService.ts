import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isWebProject } from '../../parsers/projectKind';
import { SolutionService } from '../solutionService';
import { ProjectItems } from '../projectItems/projectItems';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { changePackageVersions, OperationsHost, vscodeHost as packageOperationsHost } from '../nuget/centralPackageOperations';
import { PackageBrowseService } from '../nuget/packageBrowseService';
import { PackageOperationResult } from '../nuget/types';
import { VersionUtils } from '../versionUtils';
import { serviceReferencesOutput, showServiceReferenceFailure } from '../serviceReferences/output';
import { download } from './download';
import {
    addProtobufReference, contentHash, defaultGrpcServices, duplicateRefusal, ensureDevelopmentDependency, GrpcServices, grpcPackages,
    protobufReferenceFor, protoFileName, PROTOS_FOLDER,
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
    progress<T>(title: string, task: () => Promise<T>): Promise<T>;
    download(url: string): Promise<Buffer>;
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
    const refusal = duplicateRefusal((await host.items(projectPath))?.protobuf ?? [], projectXml, projectDir, protoPath, reference);
    if (refusal) {
        host.info(refusal);
        return false;
    }

    let downloaded: Buffer | undefined;
    if (sourceUrl) {
        try {
            downloaded = await host.progress(`Downloading ${path.basename(protoPath)}...`, () => host.download(sourceUrl));
        } catch (error) {
            host.log(`Downloading ${sourceUrl} failed: ${error instanceof Error ? error.message : error}`);
            host.fail(`Downloading ${sourceUrl} failed.`);
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
            host.fail(`gRPC reference ${path.basename(protoPath)} added, but adding its packages failed.`);
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
    progress: (title, task) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)),
    download: url => download(url),
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
