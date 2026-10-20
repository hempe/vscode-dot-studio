import { applyRequest } from '../../../../services/configurationManager/requests';
import { emptyModel } from '../../../../services/configurationManager/model';

describe('applyRequest', () => {
    const projects = ['a/a.csproj'];

    it('adds a configuration and rejects a duplicate', () => {
        const added = applyRequest(emptyModel(), { type: 'addConfiguration', name: 'Staging', copyFrom: 'Release' }, projects);
        expect(added.configurations).toContain('Staging');
        expect(() => applyRequest(added, { type: 'addConfiguration', name: 'Staging' }, projects)).toThrow();
    });

    it('renames a configuration; the project keeps building in its own one', () => {
        const renamed = applyRequest(emptyModel(), { type: 'renameConfiguration', from: 'Release', to: 'Prod' }, projects);
        expect(renamed.configurations).toEqual(['Debug', 'Prod']);
        expect(renamed.mappings['a/a.csproj']['Prod|Any CPU']).toEqual({ configuration: 'Release', platform: 'Any CPU', build: true });
    });

    it('renames a platform', () => {
        const renamed = applyRequest(emptyModel(), { type: 'renamePlatform', from: 'Any CPU', to: 'x64' }, projects);
        expect(renamed.platforms).toEqual(['x64']);
    });

    it('removes a configuration and refuses to remove the last one', () => {
        const one = applyRequest(emptyModel(), { type: 'removeConfiguration', name: 'Release' }, projects);
        expect(one.configurations).toEqual(['Debug']);
        expect(() => applyRequest(one, { type: 'removeConfiguration', name: 'Debug' }, projects)).toThrow();
        expect(() => applyRequest(emptyModel(), { type: 'removePlatform', name: 'Any CPU' }, projects)).toThrow();
    });

    it('drops an entry when the mapping is the default', () => {
        const off = applyRequest(emptyModel(), {
            type: 'setMapping', project: 'a/a.csproj', configuration: 'Debug', platform: 'Any CPU',
            mapping: { configuration: 'Debug', platform: 'Any CPU', build: false },
        }, projects);
        expect(off.mappings['a/a.csproj']['Debug|Any CPU'].build).toBe(false);
        const back = applyRequest(off, {
            type: 'setMapping', project: 'a/a.csproj', configuration: 'Debug', platform: 'Any CPU',
            mapping: { configuration: 'Debug', platform: 'Any CPU', build: true },
        }, projects);
        expect(back.mappings['a/a.csproj']?.['Debug|Any CPU']).toBeUndefined();
    });

    it('returns the model unchanged for other requests', () => {
        const model = emptyModel();
        expect(applyRequest(model, { type: 'ready' }, projects)).toBe(model);
        expect(applyRequest(model, { type: 'setActive', configuration: 'Debug', platform: 'Any CPU' }, projects)).toBe(model);
    });
});
