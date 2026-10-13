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

import { BuildConfiguration, solutionConfigurations } from '../../../services/buildConfiguration';
import { SolutionFile } from '../../../types/solution';

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
