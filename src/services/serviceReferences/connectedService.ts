import * as fs from 'fs';
import * as path from 'path';

export const CONNECTED_SERVICES = 'Connected Services';
export const VS_METADATA_FILE = 'ConnectedService.json';
export const SVCUTIL_PARAMS_FILE = 'dotnet-svcutil.params.json';
const VS_PROVIDER_ID = 'Microsoft.VisualStudio.ConnectedService.Wcf';
const VS_PROVIDER_VERSION = '15.0.40203.910';
const SVCUTIL_PROVIDER_ID = 'Microsoft.Tools.ServiceModel.Svcutil';

/** svcutil options; Visual Studio stores the same keys as `ExtendedData` */
export interface SvcutilOptions {
    inputs: string[];
    outputFile?: string;
    targetFramework?: string;
    [key: string]: unknown;
}

/** A service reference folder and its metadata file */
export interface ServiceReference {
    readonly folder: string;
    readonly name: string;
    /** `ConnectedService.json` (Visual Studio) or `dotnet-svcutil.params.json` (svcutil CLI) */
    readonly format: 'visualStudio' | 'svcutil';
    readonly providerId: string;
    readonly version?: string;
    readonly options: SvcutilOptions;
    readonly eol: string;
}

export function metadataFileName(format: ServiceReference['format']): string {
    return format === 'visualStudio' ? VS_METADATA_FILE : SVCUTIL_PARAMS_FILE;
}

/** Reads the reference in `folder`; throws an Error naming the file when it is missing or malformed */
export function readServiceReference(folder: string): ServiceReference {
    const format = fs.existsSync(path.join(folder, VS_METADATA_FILE)) ? 'visualStudio' : 'svcutil';
    const file = path.join(folder, metadataFileName(format));
    let text: string;
    let json: any;
    try {
        text = fs.readFileSync(file, 'utf8');
        json = JSON.parse(text.replace(/^﻿/, ''));
    } catch (error) {
        throw new Error(`${file} could not be read: ${error instanceof Error ? error.message : error}`);
    }
    const options = format === 'visualStudio' ? json?.ExtendedData : json?.options;
    if (!options || !Array.isArray(options.inputs) || options.inputs.length === 0) {
        throw new Error(`${file} has no inputs`);
    }
    return {
        folder,
        name: path.basename(folder),
        format,
        providerId: format === 'visualStudio' ? json.ProviderId : json.providerId,
        version: format === 'visualStudio' ? json.Version : json.version,
        options,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
    };
}

/** The metadata file's text, with the keys in the order Visual Studio / svcutil write them */
export function serializeServiceReference(ref: ServiceReference): string {
    const json = ref.format === 'visualStudio'
        ? { ProviderId: ref.providerId, Version: ref.version, ExtendedData: ref.options }
        : { providerId: ref.providerId, ...(ref.version ? { version: ref.version } : {}), options: ref.options };
    return JSON.stringify(json, null, 2).replace(/\n/g, ref.eol) + ref.eol;
}

/** A new reference in Visual Studio's format with its defaults (type reuse off, see the spec) */
export function newServiceReference(folder: string, input: string, namespace: string, targetFramework: string): ServiceReference {
    return {
        folder,
        name: path.basename(folder),
        format: 'visualStudio',
        providerId: VS_PROVIDER_ID,
        version: VS_PROVIDER_VERSION,
        options: {
            inputs: [input],
            collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
            namespaceMappings: [`*, ${namespace}`],
            outputFile: 'Reference.cs',
            targetFramework,
            typeReuseMode: 'None',
        },
        eol: '\n',
    };
}

/** `dotnet-svcutil.params.json` for `--update`, generating for the project's current framework */
export function toSvcutilParams(options: SvcutilOptions, targetFramework: string): string {
    return JSON.stringify({ providerId: SVCUTIL_PROVIDER_ID, options: { ...options, targetFramework } }, null, 2) + '\n';
}

export type ServiceFolderKind = 'connectedServices' | 'serviceReference';

/** `Connected Services` itself, or a reference folder directly in it (one with a metadata file) */
export function serviceFolderKind(projectDir: string, folderPath: string): ServiceFolderKind | undefined {
    const connectedServices = path.join(projectDir, CONNECTED_SERVICES);
    if (folderPath === connectedServices) {
        return 'connectedServices';
    }
    if (path.dirname(folderPath) === connectedServices
        && (fs.existsSync(path.join(folderPath, VS_METADATA_FILE)) || fs.existsSync(path.join(folderPath, SVCUTIL_PARAMS_FILE)))) {
        return 'serviceReference';
    }
    return undefined;
}

export function isUrl(input: string): boolean {
    return /^https?:\/\//i.test(input);
}

/** A folder name and C# namespace: letters, digits, `_` and `.` */
export function isValidReferenceName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name);
}

/** From the WSDL's file name or last URL path segment, e.g. `.../CardOperations.asmx?WSDL` → `CardOperations` */
export function suggestReferenceName(input: string, existing: readonly string[]): string {
    const withoutQuery = input.replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
    const segment = isUrl(input) && !/^https?:\/\/[^/]+$/i.test(withoutQuery)
        ? withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
        : isUrl(input) ? '' : path.basename(withoutQuery);
    let base = segment.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!base) {
        base = 'ServiceReference';
    } else if (/^[0-9]/.test(base)) {
        base = `_${base}`;
    }
    let name = base;
    for (let i = 1; existing.includes(name); i++) {
        name = `${base}${i}`;
    }
    return name;
}

/** .NET Framework TFMs (net471, net48) come with System.ServiceModel; modern ones need the WCF client packages */
export function isNetFrameworkTarget(targetFramework: string): boolean {
    return /^net\d{2,3}$/.test(targetFramework);
}

/** WCF client packages the generated code needs and the project doesn't reference yet */
export function requiredPackages(referenceCode: string, projectXml: string, targetFramework: string): string[] {
    if (isNetFrameworkTarget(targetFramework)) {
        return [];
    }
    const packages = ['System.ServiceModel.Http', 'System.ServiceModel.Primitives'];
    if (referenceCode.includes('NetTcpBinding')) {
        packages.push('System.ServiceModel.NetTcp');
    }
    return packages.filter(id => !new RegExp(`<PackageReference\\b[^>]*\\bInclude\\s*=\\s*"${id.replace(/\./g, '\\.')}"`, 'i').test(projectXml));
}
