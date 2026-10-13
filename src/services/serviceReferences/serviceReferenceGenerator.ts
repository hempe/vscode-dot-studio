import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import {
    CONNECTED_SERVICES, isUrl, metadataFileName, requiredPackages, serializeServiceReference, ServiceReference,
    SVCUTIL_PARAMS_FILE, toSvcutilParams,
} from './connectedService';
import { ProcessResult } from './svcutil';

/** Runs dotnet-svcutil with `args` in `cwd` (the project directory) */
export type Svcutil = (args: string[], cwd: string) => Promise<ProcessResult>;

export interface GenerateOptions {
    readonly projectPath: string;
    /** Existing reference, or a new one from `newServiceReference` */
    readonly reference: ServiceReference;
    /** The project's target framework the client is generated for */
    readonly targetFramework: string;
    readonly svcutil: Svcutil;
    /** Adds the latest stable version of a package (`dotnet add package`) */
    readonly addPackage: (projectPath: string, packageId: string) => Promise<void>;
}

export type GenerateResult = { success: true; output: string } | { success: false; output: string };

/**
 * Generates the client in a temporary folder under obj/ and only on success replaces the reference's files.
 * svcutil's own project file edits (old 4.10.* packages) are undone; current packages are added instead.
 */
export async function generateServiceReference(options: GenerateOptions): Promise<GenerateResult> {
    const { projectPath, reference, targetFramework } = options;
    const projectDir = path.dirname(projectPath);
    const tempDir = path.join(projectDir, 'obj', `shinobi-svcutil-${crypto.randomBytes(4).toString('hex')}`);
    const projectXml = fs.readFileSync(projectPath, 'utf8');

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        // Local inputs are copied next to the params file, as svcutil resolves them relative to it
        const localInputs = new Map<string, string>();
        const inputs = reference.options.inputs.map(input => {
            if (isUrl(input)) {
                return input;
            }
            const source = path.resolve(reference.folder, input);
            const name = path.basename(source);
            fs.copyFileSync(source, path.join(tempDir, name));
            localInputs.set(name, source);
            return name;
        });
        fs.writeFileSync(path.join(tempDir, SVCUTIL_PARAMS_FILE), toSvcutilParams({ ...reference.options, inputs }, targetFramework));

        const result = await options.svcutil(['--update', path.relative(projectDir, tempDir), '--noLogo'], projectDir);
        fs.writeFileSync(projectPath, projectXml);

        const outputFile = reference.options.outputFile ?? 'Reference.cs';
        if (result.code !== 0 || !fs.existsSync(path.join(tempDir, outputFile))) {
            return { success: false, output: explainSvcutilFailure(result.output) };
        }

        fs.mkdirSync(reference.folder, { recursive: true });
        fs.copyFileSync(path.join(tempDir, outputFile), path.join(reference.folder, outputFile));
        for (const [name, source] of localInputs) {
            const target = path.join(reference.folder, name);
            if (path.resolve(source) !== path.resolve(target)) {
                fs.copyFileSync(source, target);
            }
        }

        // Inputs as the reference had them; everything else as svcutil used it
        const used = JSON.parse(fs.readFileSync(path.join(tempDir, SVCUTIL_PARAMS_FILE), 'utf8')).options;
        const updated: ServiceReference = {
            ...reference,
            options: { ...used, inputs: reference.options.inputs.map(input => isUrl(input) ? input : path.basename(input)) },
        };
        fs.writeFileSync(path.join(reference.folder, metadataFileName(updated.format)), serializeServiceReference(updated));
        if (updated.format === 'visualStudio') {
            fs.rmSync(path.join(reference.folder, SVCUTIL_PARAMS_FILE), { force: true });
        }

        fs.writeFileSync(projectPath, ProjectFileEditor.ensureWcfMetadata(projectXml));
        const code = fs.readFileSync(path.join(reference.folder, outputFile), 'utf8');
        for (const id of requiredPackages(code, projectXml, targetFramework)) {
            await options.addPackage(projectPath, id);
        }
        return { success: true, output: result.output };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/** svcutil's output, plus what to do about errors it explains badly */
export function explainSvcutilFailure(output: string): string {
    const frameworkReference = /The project reference specification '([^']+)' does not have a file path/.exec(output);
    if (frameworkReference) {
        return `${output}\n\nsvcutil reads the project's references and cannot resolve .NET Framework assembly references without a path. `
            + `Remove <Reference Include="${frameworkReference[1]}" /> from the project file (on modern .NET the WCF client comes from NuGet packages, `
            + 'which are added after generating) and try again.';
    }
    return output;
}

/** Deletes the reference folder; the last one also takes `Connected Services` and the WCFMetadata item */
export async function removeServiceReference(projectPath: string, folder: string): Promise<void> {
    fs.rmSync(folder, { recursive: true, force: true });
    const connectedServices = path.join(path.dirname(projectPath), CONNECTED_SERVICES);
    if (fs.existsSync(connectedServices) && fs.readdirSync(connectedServices).length === 0) {
        fs.rmdirSync(connectedServices);
        fs.writeFileSync(projectPath, ProjectFileEditor.removeWcfMetadata(fs.readFileSync(projectPath, 'utf8')));
    }
}
