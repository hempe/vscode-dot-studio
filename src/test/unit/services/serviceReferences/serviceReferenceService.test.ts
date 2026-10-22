const showQuickPick = jest.fn();
jest.mock('vscode', () => ({
    window: { showQuickPick, createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });
jest.mock('../../../../services/grpc/grpcReferenceService', () => ({ addGrpcReference: jest.fn() }));

import * as path from 'path';
import { addGrpcReference } from '../../../../services/grpc/grpcReferenceService';
import { addServiceReference } from '../../../../services/serviceReferences/serviceReferenceService';
import { SolutionService } from '../../../../services/solutionService';

describe('Add Service Reference: the kind of service first', () => {
    const projectPath = path.resolve('/work/App/App.csproj');

    beforeEach(() => {
        jest.spyOn(SolutionService, 'getActiveSolution').mockReturnValue({ projects: new Map([[projectPath, {}]]) } as never);
        showQuickPick.mockReset();
        (addGrpcReference as jest.Mock).mockReset();
    });
    afterEach(() => jest.restoreAllMocks());

    test('gRPC goes to the gRPC flow, from the project and from its Connected Services folder', async () => {
        showQuickPick.mockImplementation(async (items: { label: string }[]) => items.find(item => item.label === 'gRPC'));
        await addServiceReference(projectPath);
        await addServiceReference(path.join(path.dirname(projectPath), 'Connected Services'));
        expect(addGrpcReference).toHaveBeenNthCalledWith(1, projectPath);
        expect(addGrpcReference).toHaveBeenNthCalledWith(2, projectPath);
        expect(showQuickPick.mock.calls[0][0].map((item: { label: string }) => item.label)).toEqual(['WCF Web Service', 'gRPC']);
    });

    test('WCF Web Service goes on with the WSDL question, as before; Escape does nothing', async () => {
        showQuickPick.mockResolvedValueOnce({ label: 'WCF Web Service' }).mockResolvedValueOnce(undefined);
        await addServiceReference(projectPath);
        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(showQuickPick.mock.calls[1][1]).toEqual({ placeHolder: 'Where is the service description (WSDL)?' });
        showQuickPick.mockReset().mockResolvedValueOnce(undefined);
        await addServiceReference(projectPath);
        expect(showQuickPick).toHaveBeenCalledTimes(1);
        expect(addGrpcReference).not.toHaveBeenCalled();
    });
});
