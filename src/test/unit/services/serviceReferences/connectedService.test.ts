import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CONNECTED_SERVICES, isValidReferenceName, newServiceReference, readServiceReference,
    requiredPackages, serializeServiceReference, serviceFolderKind, suggestReferenceName, toSvcutilParams,
} from '../../../../services/serviceReferences/connectedService';

const payLoop = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');
const cardOperations = path.join(payLoop, CONNECTED_SERVICES, 'CardOperations');

describe('connected service metadata', () => {
    it('reads Visual Studio references', () => {
        const ref = readServiceReference(cardOperations);
        expect(ref).toMatchObject({
            name: 'CardOperations',
            format: 'visualStudio',
            providerId: 'Microsoft.VisualStudio.ConnectedService.Wcf',
            version: '15.0.40203.910',
        });
        expect(ref.options).toEqual({
            inputs: ['CardOperations.wsdl'],
            collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
            messageContract: true,
            namespaceMappings: ['*, CardOperations'],
            targetFramework: 'net471',
            typeReuseMode: 'None',
        });
    });

    it('writes Visual Studio references back unchanged', () => {
        const text = fs.readFileSync(path.join(cardOperations, 'ConnectedService.json'), 'utf8');
        expect(serializeServiceReference(readServiceReference(cardOperations))).toBe(text);
    });

    it('reads and writes references created with the svcutil CLI in their own format', () => {
        const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'svcref-')));
        const params = { providerId: 'Microsoft.Tools.ServiceModel.Svcutil', version: '8.0.0', options: { inputs: ['a.wsdl'], outputFile: 'Reference.cs' } };
        fs.writeFileSync(path.join(folder, 'dotnet-svcutil.params.json'), JSON.stringify(params, null, 2) + '\n');

        const ref = readServiceReference(folder);
        expect(ref.format).toBe('svcutil');
        expect(JSON.parse(serializeServiceReference(ref))).toEqual(params);
        fs.rmSync(folder, { recursive: true });
    });

    it('names the file in the error for malformed metadata', () => {
        const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'svcref-')));
        fs.writeFileSync(path.join(folder, 'ConnectedService.json'), '{ "ExtendedData": ');
        expect(() => readServiceReference(folder)).toThrow(/ConnectedService\.json/);
        fs.rmSync(folder, { recursive: true });
    });

    it('creates new references in Visual Studio format with its defaults', () => {
        const ref = newServiceReference('/p/Connected Services/Calc', 'http://x/calc.asmx?WSDL', 'Calc', 'net10.0');
        expect(JSON.parse(serializeServiceReference(ref))).toEqual({
            ProviderId: 'Microsoft.VisualStudio.ConnectedService.Wcf',
            Version: '15.0.40203.910',
            ExtendedData: {
                inputs: ['http://x/calc.asmx?WSDL'],
                collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
                namespaceMappings: ['*, Calc'],
                outputFile: 'Reference.cs',
                targetFramework: 'net10.0',
                typeReuseMode: 'None',
            },
        });
    });

    it('turns options into an svcutil params file for the current framework', () => {
        const params = JSON.parse(toSvcutilParams(readServiceReference(cardOperations).options, 'net10.0'));
        expect(params.providerId).toBe('Microsoft.Tools.ServiceModel.Svcutil');
        expect(params.options.targetFramework).toBe('net10.0');
        expect(params.options.messageContract).toBe(true);
    });
});

describe('service folders', () => {
    it('recognizes Connected Services and the reference folders in it', () => {
        expect(serviceFolderKind(payLoop, path.join(payLoop, CONNECTED_SERVICES))).toBe('connectedServices');
        expect(serviceFolderKind(payLoop, cardOperations)).toBe('serviceReference');
        expect(serviceFolderKind(payLoop, path.join(payLoop, 'Properties'))).toBeUndefined();
        expect(serviceFolderKind(payLoop, path.join(payLoop, CONNECTED_SERVICES, 'Nothing'))).toBeUndefined();
    });
});

describe('reference names', () => {
    it('suggests a name from URLs and files', () => {
        expect(suggestReferenceName('http://test.payloop.com/CardsWebFront/Services/CardOperations.asmx?WSDL', [])).toBe('CardOperations');
        expect(suggestReferenceName('https://x/Service.svc?singleWsdl', [])).toBe('Service');
        expect(suggestReferenceName('/home/me/My Service-v2.wsdl', [])).toBe('My_Service_v2');
        expect(suggestReferenceName('https://x/', [])).toBe('ServiceReference');
        expect(suggestReferenceName('https://x/2024.wsdl', [])).toBe('_2024');
    });

    it('avoids existing names', () => {
        expect(suggestReferenceName('a/Calc.wsdl', ['Calc', 'Calc1'])).toBe('Calc2');
    });

    it('validates names', () => {
        expect(isValidReferenceName('CardOperations')).toBe(true);
        expect(isValidReferenceName('Card.Operations')).toBe(true);
        expect(isValidReferenceName('')).toBe(false);
        expect(isValidReferenceName('a/b')).toBe(false);
        expect(isValidReferenceName('..')).toBe(false);
    });
});

describe('required packages', () => {
    const http = 'new System.ServiceModel.BasicHttpBinding()';

    it('Http and Primitives for HTTP clients, NetTcp only when needed', () => {
        expect(requiredPackages(http, '<Project />', 'net10.0')).toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives']);
        expect(requiredPackages(http + ' new System.ServiceModel.NetTcpBinding()', '<Project />', 'net10.0'))
            .toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives', 'System.ServiceModel.NetTcp']);
    });

    it('skips packages the project references', () => {
        expect(requiredPackages(http, '<PackageReference Include="System.ServiceModel.Http" Version="10.0.652802" />', 'net10.0'))
            .toEqual(['System.ServiceModel.Primitives']);
    });

    it('none for .NET Framework, which has System.ServiceModel built in', () => {
        expect(requiredPackages(http, '<Project />', 'net471')).toEqual([]);
    });
});
