import {
    msbuildPlatform, emptyModel, resolveMapping, setMapping, addConfiguration, renameConfiguration, removeConfiguration,
    addPlatform, renamePlatform, removePlatform,
} from '../../../../../services/build/configurationManager/model';

const project = 'src/App/App.csproj';

describe('msbuildPlatform', () => {
    it('drops the space of "Any CPU"', () => {
        expect(msbuildPlatform('Any CPU')).toBe('AnyCPU');
        expect(msbuildPlatform('x64')).toBe('x64');
    });
});

describe('resolveMapping', () => {
    it('defaults to the same configuration and platform with Build on', () => {
        const model = emptyModel();
        expect(resolveMapping(model, project, 'Debug', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: true });
    });

    it('returns an explicit mapping', () => {
        const model = setMapping(emptyModel(), project, 'Debug', 'Any CPU', { configuration: 'Release', platform: 'x64', build: false });
        expect(resolveMapping(model, project, 'Debug', 'Any CPU')).toEqual({ configuration: 'Release', platform: 'x64', build: false });
    });
});

describe('configuration and platform lists', () => {
    it('adds a configuration copying the mappings of another', () => {
        let model = setMapping(emptyModel(), project, 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'x64', build: false });
        model = addConfiguration(model, 'Staging', 'Debug');
        expect(model.configurations).toEqual(['Debug', 'Release', 'Staging']);
        expect(resolveMapping(model, project, 'Staging', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'x64', build: false });
    });

    it('refuses a duplicate name, ignoring case', () => {
        expect(() => addConfiguration(emptyModel(), 'debug')).toThrow('already exists');
    });

    it('renames a configuration in the list and the mapping keys, keeping the mapping values', () => {
        let model = setMapping(emptyModel(), project, 'Release', 'Any CPU', { configuration: 'Release', platform: 'x64', build: true });
        model = renameConfiguration(model, 'Release', 'Prod', [project]);
        expect(model.configurations).toEqual(['Debug', 'Prod']);
        expect(resolveMapping(model, project, 'Prod', 'Any CPU')).toEqual({ configuration: 'Release', platform: 'x64', build: true });
    });

    it('renaming a configuration makes the implicit default of the projects explicit', () => {
        const model = renameConfiguration(emptyModel(), 'Release', 'Prod', ['app']);
        expect(resolveMapping(model, 'app', 'Prod', 'Any CPU')).toEqual({ configuration: 'Release', platform: 'Any CPU', build: true });
        expect(model.mappings.app['Prod|Any CPU']).toBeDefined();
        expect(resolveMapping(model, 'app', 'Debug', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: true });
        expect(Object.keys(model.mappings.app)).toEqual(['Prod|Any CPU']);
    });

    it('renaming a configuration makes the default explicit for each platform', () => {
        const model = renameConfiguration(addPlatform(emptyModel(), 'x64'), 'Release', 'Prod', ['app']);
        expect(resolveMapping(model, 'app', 'Prod', 'x64')).toEqual({ configuration: 'Release', platform: 'x64', build: true });
        expect(Object.keys(model.mappings.app).sort()).toEqual(['Prod|Any CPU', 'Prod|x64']);
    });

    it('renaming a configuration accepts a case-only change', () => {
        const model = renameConfiguration(emptyModel(), 'Release', 'release', ['app']);
        expect(model.configurations).toEqual(['Debug', 'release']);
        expect(resolveMapping(model, 'app', 'release', 'Any CPU').configuration).toBe('Release');
    });

    it('removes a configuration and its mappings, but never the last one', () => {
        const model = removeConfiguration(emptyModel(), 'Release');
        expect(model.configurations).toEqual(['Debug']);
        expect(() => removeConfiguration(model, 'Debug')).toThrow('last');
    });

    it('adds, renames and removes platforms like configurations', () => {
        let model = addPlatform(emptyModel(), 'x64');
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
        model = renamePlatform(model, 'x64', 'x86', []);
        expect(model.platforms).toEqual(['Any CPU', 'x86']);
        model = removePlatform(model, 'x86');
        expect(model.platforms).toEqual(['Any CPU']);
        expect(() => removePlatform(model, 'Any CPU')).toThrow('last');
    });

    it('rejects names with characters the solution file cannot hold', () => {
        expect(() => addConfiguration(emptyModel(), 'a|b')).toThrow('invalid');
        expect(() => addPlatform(emptyModel(), '')).toThrow('invalid');
    });
});

describe('mappings follow renames and removals', () => {
    const mapped = () => setMapping(
        setMapping(emptyModel(), project, 'Release', 'Any CPU', { configuration: 'Release', platform: 'x64', build: true }),
        project, 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'x64', build: false });

    it('renaming a platform renames the keys and keeps the values that point to the old name', () => {
        const model = renamePlatform(addPlatform(mapped(), 'x64'), 'x64', 'ARM64', [project]);
        expect(resolveMapping(model, project, 'Release', 'Any CPU').platform).toBe('x64');
        expect(resolveMapping(model, project, 'Debug', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'x64', build: false });
        const keyed = renamePlatform(addPlatform(setMapping(emptyModel(), project, 'Debug', 'x64', { configuration: 'Debug', platform: 'Any CPU', build: false }), 'x64'), 'x64', 'x86', [project]);
        expect(resolveMapping(keyed, project, 'Debug', 'x86')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: false });
        expect(resolveMapping(keyed, project, 'Debug', 'x64').build).toBe(true);
    });

    it('renaming a platform makes the implicit default of the projects explicit', () => {
        const model = renamePlatform(addPlatform(emptyModel(), 'x64'), 'x64', 'ARM64', ['app']);
        expect(resolveMapping(model, 'app', 'Debug', 'ARM64')).toEqual({ configuration: 'Debug', platform: 'x64', build: true });
        expect(resolveMapping(model, 'app', 'Release', 'ARM64')).toEqual({ configuration: 'Release', platform: 'x64', build: true });
        expect(Object.keys(model.mappings.app).sort()).toEqual(['Debug|ARM64', 'Release|ARM64']);
        expect(resolveMapping(model, 'app', 'Debug', 'Any CPU').platform).toBe('Any CPU');
    });

    it('renaming a platform accepts a case-only change', () => {
        const model = renamePlatform(addPlatform(emptyModel(), 'x64'), 'x64', 'X64', ['app']);
        expect(model.platforms).toEqual(['Any CPU', 'X64']);
        expect(resolveMapping(model, 'app', 'Debug', 'X64').platform).toBe('x64');
    });

    it('removing keeps the values of the other mappings', () => {
        const model = removePlatform(addPlatform(setMapping(emptyModel(), project, 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'x64', build: true }), 'x64'), 'x64');
        expect(resolveMapping(model, project, 'Debug', 'Any CPU').platform).toBe('x64');
    });

    it('removing a configuration deletes the mappings that belong to it and keeps the others', () => {
        const model = removeConfiguration(mapped(), 'Release');
        expect(Object.keys(model.mappings[project])).toEqual(['Debug|Any CPU']);
        expect(resolveMapping(model, project, 'Release', 'Any CPU').platform).toBe('Any CPU');
    });

    it('removing the last mapping of a project drops the project entry', () => {
        const model = removeConfiguration(setMapping(emptyModel(), project, 'Release', 'Any CPU', { configuration: 'Release', platform: 'x64', build: true }), 'Release');
        expect(model.mappings).toEqual({});
    });

    it('removing a platform deletes its mappings', () => {
        const model = removePlatform(addPlatform(setMapping(emptyModel(), project, 'Debug', 'x64', { configuration: 'Debug', platform: 'x64', build: false }), 'x64'), 'x64');
        expect(model.mappings).toEqual({});
    });

    it('does not mutate the model it was given', () => {
        const before = mapped();
        const snapshot = JSON.stringify(before);
        addConfiguration(before, 'Staging', 'Debug');
        renameConfiguration(before, 'Debug', 'Dev', [project, 'other']);
        renamePlatform(addPlatform(before, 'x64'), 'x64', 'x86', [project]);
        removeConfiguration(before, 'Release');
        expect(JSON.stringify(before)).toBe(snapshot);
    });
});
