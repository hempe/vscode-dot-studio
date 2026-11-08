import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solution/solutionService';
import { DebugConfigService } from '../debug/debugConfigService';
import { PackageOperationsService } from '../nuget/packageOperationsService';
import {
    CONNECTED_SERVICES, isValidReferenceName, newServiceReference, readServiceReference, ServiceReference, suggestReferenceName,
} from './connectedService';
import { findSvcutil, installSvcutil, runSvcutil, SvcutilInstall } from './svcutil';
import { generateServiceReference, removeServiceReference } from './serviceReferenceGenerator';
import { workspaceFolderOf } from '../solution/workspaceFolders';
import { serviceReferencesOutput as outputChannel, showServiceReferenceFailure as showFailure } from './output';
import { addGrpcReference } from '../grpc/grpcReferenceService';
import { t } from '../../core/i18n';

const log = logger('ServiceReferences');

/** The project a node path belongs to: the project itself, its Connected Services folder or a reference folder */
function projectFor(nodePath: string): string | undefined {
    const projects = [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])];
    if (projects.includes(nodePath)) {
        return nodePath;
    }
    const dir = path.basename(nodePath) === CONNECTED_SERVICES ? path.dirname(nodePath) : path.dirname(path.dirname(nodePath));
    return projects.find(project => path.dirname(project) === dir);
}

async function targetFramework(projectPath: string): Promise<string | undefined> {
    return (await DebugConfigService.extractTargetFrameworks(projectPath))[0];
}

/** The installed tool, or the user's choice to install it */
async function ensureSvcutil(projectDir: string): Promise<SvcutilInstall | undefined> {
    const found = await findSvcutil(projectDir);
    if (found) {
        return found;
    }
    const local = 'Install for this Repository';
    const global = 'Install Globally';
    const choice = await vscode.window.showWarningMessage(
        t('Service references need dotnet-svcutil. Installing it for the repository adds it to .config/dotnet-tools.json, so the whole team gets the same version.'),
        { modal: true }, local, global);
    if (!choice) {
        return undefined;
    }
    const install: SvcutilInstall = choice === local ? 'local' : 'global';
    const workspaceDir = workspaceFolderOf(projectDir)?.uri.fsPath ?? projectDir;
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('Installing dotnet-svcutil...') },
        () => installSvcutil(install, workspaceDir));
    outputChannel().appendLine(result.output);
    if (result.code !== 0) {
        void showFailure(t('Installing dotnet-svcutil failed.'));
        return undefined;
    }
    return install;
}

async function generate(projectPath: string, reference: ServiceReference, verb: 'Adding' | 'Updating'): Promise<void> {
    const framework = await targetFramework(projectPath);
    if (!framework) {
        vscode.window.showErrorMessage(t('Could not determine the target framework of {0}.', path.basename(projectPath)));
        return;
    }
    const install = await ensureSvcutil(path.dirname(projectPath));
    if (!install) {
        return;
    }
    outputChannel().appendLine(`${verb} ${reference.name} for ${framework}...`);
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: verb === 'Adding' ? t('Adding service reference {0}...', reference.name) : t('Updating service reference {0}...', reference.name) },
        () => generateServiceReference({
            projectPath, reference, targetFramework: framework,
            svcutil: (args, cwd) => runSvcutil(install, args, cwd),
            addPackage: async (project, packageId) => {
                const added = await PackageOperationsService.installPackage({ projectPath: project, packageId });
                outputChannel().appendLine(added.message);
            },
        }));
    outputChannel().appendLine(result.output);
    if (!result.success) {
        void showFailure(`${verb} service reference ${reference.name} failed.`);
        return;
    }
    vscode.window.showInformationMessage(verb === 'Adding'
        ? t('Service reference {0} added.', reference.name)
        : t('Service reference {0} updated.', reference.name));
}

const WCF = 'WCF Web Service';
const GRPC = 'gRPC';

/** Visual Studio's choice of service type first; WCF then goes on as before, gRPC to its own flow */
export async function addServiceReference(nodePath: string): Promise<void> {
    const projectPath = projectFor(nodePath);
    if (!projectPath) {
        return;
    }
    const kind = await vscode.window.showQuickPick([
        { label: WCF, description: t('SOAP client from a WSDL, generated with dotnet-svcutil') },
        { label: GRPC, description: t('Client or server code from a .proto file, generated by Grpc.Tools at build') },
    ], { placeHolder: t('Which kind of service?') });
    if (kind?.label === GRPC) {
        await addGrpcReference(projectPath);
    } else if (kind?.label === WCF) {
        await addWcfServiceReference(projectPath);
    }
}

async function addWcfServiceReference(projectPath: string): Promise<void> {
    const url = t('Enter URL...');
    const file = t('Browse for WSDL File...');
    const source = await vscode.window.showQuickPick([url, file], { placeHolder: t('Where is the service description (WSDL)?') });
    let input: string | undefined;
    if (source === url) {
        input = await vscode.window.showInputBox({
            prompt: t('Address of the WSDL, e.g. https://example.com/Service.svc?wsdl'), ignoreFocusOut: true,
            validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : t('Enter an http(s) URL'),
        });
    } else if (source === file) {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false, openLabel: t('Add Service Reference'),
            filters: { [t('Service descriptions')]: ['wsdl', 'xml'], [t('All files')]: ['*'] },
        });
        input = picked?.[0]?.fsPath;
    }
    if (!input) {
        return;
    }
    input = input.trim();

    const connectedServices = path.join(path.dirname(projectPath), CONNECTED_SERVICES);
    const existing = fs.existsSync(connectedServices) ? fs.readdirSync(connectedServices) : [];
    const name = await vscode.window.showInputBox({
        prompt: t('Service reference name (folder under Connected Services)'), value: suggestReferenceName(input, existing), ignoreFocusOut: true,
        validateInput: value => !isValidReferenceName(value) ? t('Use letters, digits, _ and .') : existing.includes(value) ? t('{0} already exists', value) : undefined,
    });
    if (!name) {
        return;
    }
    const namespace = await vscode.window.showInputBox({
        prompt: t('Namespace for the generated code'), value: name, ignoreFocusOut: true,
        validateInput: value => isValidReferenceName(value) ? undefined : t('Not a valid namespace'),
    });
    if (!namespace) {
        return;
    }
    const framework = await targetFramework(projectPath) ?? 'net10.0';
    await generate(projectPath, newServiceReference(path.join(connectedServices, name), input, namespace, framework), 'Adding');
}

export async function updateServiceReference(folder: string): Promise<void> {
    const projectPath = projectFor(folder);
    if (!projectPath) {
        return;
    }
    let reference: ServiceReference;
    try {
        reference = readServiceReference(folder);
    } catch (error) {
        log.error('Cannot read service reference:', error);
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return;
    }
    await generate(projectPath, reference, 'Updating');
}

export async function removeServiceReferenceWithConfirmation(folder: string): Promise<void> {
    const projectPath = projectFor(folder);
    if (!projectPath) {
        return;
    }
    const answer = await vscode.window.showWarningMessage(
        t('Remove the service reference \'{0}\'? Its folder is deleted; packages stay.', path.basename(folder)), { modal: true }, t('Remove'));
    if (answer === t('Remove')) {
        await removeServiceReference(projectPath, folder);
    }
}
