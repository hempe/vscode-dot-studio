const contexts: Record<string, unknown> = {};

jest.mock('vscode', () => ({
    commands: {
        executeCommand: async (command: string, key: string, value: unknown) => {
            if (command === 'setContext') {
                contexts[key] = value;
            }
        },
    },
}), { virtual: true });

import { BuildConfiguration, solutionConfigurations, solutionPlatforms } from '../../../../services/build/buildConfiguration';
import { SolutionFile } from '../../../../types/solution';

const memento = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        update: async (key: string, value: unknown) => { values.set(key, value); },
        keys: () => [...values.keys()],
    };
};

const solutionWith = (items?: Record<string, string>): SolutionFile => ({
    formatVersion: '12.00',
    projects: [],
    nestedProjects: [],
    globalSections: items ? [{ name: 'SolutionConfigurationPlatforms', type: 'preSolution', items }] : [],
} as unknown as SolutionFile);

describe('solutionConfigurations', () => {
    it('lists each configuration of the solution once, whatever the platforms', () => {
        expect(solutionConfigurations(solutionWith({
            'Debug|Any CPU': 'Debug|Any CPU',
            'Debug|x64': 'Debug|x64',
            'Release|Any CPU': 'Release|Any CPU',
            'Staging|Any CPU': 'Staging|Any CPU',
        }))).toEqual(['Debug', 'Release', 'Staging']);
    });

    it('defaults to Debug and Release', () => {
        expect(solutionConfigurations(solutionWith())).toEqual(['Debug', 'Release']);
        expect(solutionConfigurations(undefined)).toEqual(['Debug', 'Release']);
    });
});

describe('BuildConfiguration', () => {
    let changes: string[];
    let listener: { dispose(): void };

    beforeEach(() => {
        BuildConfiguration.initialize(memento() as any);
        BuildConfiguration.setAvailable(['Debug', 'Release']);
        changes = [];
        listener = BuildConfiguration.onDidChange(configuration => changes.push(configuration));
    });

    afterEach(() => listener.dispose());

    it('starts on Debug', () => {
        expect(BuildConfiguration.active).toBe('Debug');
        expect(contexts['shinobi.solution.configuration']).toBe('Debug');
        expect(contexts['shinobi.solution.hasOtherConfigurations']).toBe(false);
    });

    it('switches and tells listeners', async () => {
        await BuildConfiguration.set('Release');
        await BuildConfiguration.set('Release');
        expect(BuildConfiguration.active).toBe('Release');
        expect(contexts['shinobi.solution.configuration']).toBe('Release');
        expect(changes).toEqual(['Release']);
    });

    it('ignores configurations the solution does not have', async () => {
        await BuildConfiguration.set('Staging');
        expect(BuildConfiguration.active).toBe('Debug');
        expect(changes).toEqual([]);
    });

    it('falls back when the solution drops the chosen configuration', async () => {
        BuildConfiguration.setAvailable(['Debug', 'Release', 'Staging']);
        expect(contexts['shinobi.solution.hasOtherConfigurations']).toBe(true);
        await BuildConfiguration.set('Staging');

        BuildConfiguration.setAvailable(['Debug', 'Release']);

        expect(BuildConfiguration.active).toBe('Debug');
        expect(changes).toEqual(['Staging', 'Debug']);
    });

    it('uses the first configuration of a solution without Debug', () => {
        BuildConfiguration.setAvailable(['Dev', 'Prod']);
        expect(BuildConfiguration.active).toBe('Dev');
    });
});

describe('solutionPlatforms', () => {
    it('lists each platform of the solution once, whatever the configurations', () => {
        expect(solutionPlatforms(solutionWith({
            'Debug|Any CPU': 'Debug|Any CPU',
            'Debug|x64': 'Debug|x64',
            'Release|Any CPU': 'Release|Any CPU',
            'Release|x64': 'Release|x64',
        }))).toEqual(['Any CPU', 'x64']);
    });

    it('defaults to Any CPU', () => {
        expect(solutionPlatforms(solutionWith())).toEqual(['Any CPU']);
        expect(solutionPlatforms(undefined)).toEqual(['Any CPU']);
    });
});

describe('BuildConfiguration platform', () => {
    let changes: string[];
    let listener: { dispose(): void };

    beforeEach(() => {
        BuildConfiguration.initialize(memento() as any);
        BuildConfiguration.setAvailable(['Debug', 'Release']);
        BuildConfiguration.setAvailablePlatforms(['Any CPU']);
        changes = [];
        listener = BuildConfiguration.onDidChange(configuration => changes.push(configuration));
    });

    afterEach(() => listener.dispose());

    it('starts on Any CPU', () => {
        expect(BuildConfiguration.availablePlatforms).toEqual(['Any CPU']);
        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
        expect(contexts['shinobi.solution.platform']).toBe('Any CPU');
        expect(contexts['shinobi.solution.availablePlatforms']).toEqual(['Any CPU']);
        expect(contexts['shinobi.solution.hasSeveralPlatforms']).toBe(false);
    });

    it('switches and tells listeners once', async () => {
        BuildConfiguration.setAvailablePlatforms(['Any CPU', 'x64']);
        await BuildConfiguration.setPlatform('x64');
        await BuildConfiguration.setPlatform('x64');
        expect(BuildConfiguration.activePlatform).toBe('x64');
        expect(contexts['shinobi.solution.platform']).toBe('x64');
        expect(contexts['shinobi.solution.hasSeveralPlatforms']).toBe(true);
        expect(changes).toEqual(['Debug']);
    });

    it('ignores platforms the solution does not have', async () => {
        await BuildConfiguration.setPlatform('x64');
        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
        expect(changes).toEqual([]);
    });

    it('falls back when the solution drops the chosen platform', async () => {
        BuildConfiguration.setAvailablePlatforms(['Any CPU', 'x64']);
        await BuildConfiguration.setPlatform('x64');
        changes.length = 0;

        BuildConfiguration.setAvailablePlatforms(['Any CPU']);

        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
        expect(changes).toEqual(['Debug']);
    });

    it('does not fire when the available platforms change nothing', () => {
        BuildConfiguration.setAvailablePlatforms(['Any CPU', 'x64']);
        expect(changes).toEqual([]);
    });

    it('uses Any CPU when available, else the first platform', () => {
        BuildConfiguration.setAvailablePlatforms(['x86', 'Any CPU']);
        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
        BuildConfiguration.setAvailablePlatforms(['x86', 'x64']);
        expect(BuildConfiguration.activePlatform).toBe('x86');
    });
});
