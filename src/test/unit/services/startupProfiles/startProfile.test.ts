import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../../../../services/debugConfigService', () => ({ DebugConfigService: {} }));
jest.mock('../../../../services/solutionService', () => ({ SolutionService: {} }));
jest.mock('../../../../services/unloadedProjects', () => ({ UnloadedProjects: {} }));

import { planProfileLaunch, startupPickItems } from '../../../../services/startupProfiles/startProfile';
import { StartupAction, StartupProfile } from '../../../../services/startupProfiles/slnLaunch';

const root = path.resolve('/repo');
const solutionPath = path.join(root, 'Shop.sln');
const solutionProjects = [
    { path: 'src/Web/Web.csproj' },
    { path: 'src/Worker/Worker.csproj' },
    { path: 'src/Data/Data.csproj' },
];

const profile = (projects: Array<[string, StartupAction, Record<string, unknown>?]>, name = 'Feature'): StartupProfile => ({
    name,
    extra: {},
    projects: projects.map(([projectPath, action, extra]) => ({ path: projectPath, action, extra: extra ?? {} })),
});

describe('planProfileLaunch', () => {
    it('starts the projects in the profile\'s order, without debugging where asked, and skips None', () => {
        const plan = planProfileLaunch(profile([
            ['src/Worker/Worker.csproj', 'StartWithoutDebugging'],
            ['src/Data/Data.csproj', 'None'],
            ['src/Web/Web.csproj', 'Start'],
        ]), solutionPath, solutionProjects);

        expect(plan).toEqual({
            missing: [],
            launches: [
                { projectPath: path.join(root, 'src', 'Worker', 'Worker.csproj'), name: 'Feature: Worker', noDebug: true, launchProfile: undefined },
                { projectPath: path.join(root, 'src', 'Web', 'Web.csproj'), name: 'Feature: Web', noDebug: false, launchProfile: undefined },
            ],
        });
    });

    it('matches paths case-insensitively, with ./ and absolute, and uses DebugTarget as the launch profile', () => {
        const plan = planProfileLaunch(profile([
            ['./SRC/web/web.CSPROJ', 'Start', { DebugTarget: 'https' }],
            [path.join(root, 'src', 'Worker', 'Worker.csproj'), 'Start', { DebugTarget: 42 }],
        ]), solutionPath, solutionProjects);

        expect(plan.missing).toEqual([]);
        expect(plan.launches.map(launch => [launch.projectPath, launch.launchProfile])).toEqual([
            [path.join(root, 'src', 'Web', 'Web.csproj'), 'https'],
            [path.join(root, 'src', 'Worker', 'Worker.csproj'), undefined],
        ]);
    });

    it('reports projects the solution does not have and skips them', () => {
        const plan = planProfileLaunch(profile([
            ['src/Gone/Gone.csproj', 'Start'],
            ['src/Web/Web.csproj', 'Start'],
            ['src/Old/Old.csproj', 'None'],
        ]), solutionPath, solutionProjects);

        expect(plan.missing).toEqual(['src/Gone/Gone.csproj']);
        expect(plan.launches.map(launch => launch.name)).toEqual(['Feature: Web']);
    });

    it('tells projects with the same name apart by their path and starts a project once', () => {
        const plan = planProfileLaunch(profile([
            ['a/App/App.csproj', 'Start'],
            ['b/App/App.csproj', 'Start'],
            ['a/App/App.csproj', 'StartWithoutDebugging'],
        ]), solutionPath, [{ path: 'a/App/App.csproj' }, { path: 'b/App/App.csproj' }]);

        expect(plan.launches.map(launch => launch.name)).toEqual(['Feature: a/App/App', 'Feature: b/App/App']);
    });
});

describe('startupPickItems', () => {
    const files = {
        shared: { profiles: [profile([['src/Web/Web.csproj', 'Start'], ['src/Worker/Worker.csproj', 'StartWithoutDebugging']], 'Team')] },
        user: { profiles: [profile([['src/Data/Data.csproj', 'None']], 'Mine')] },
    };

    it('offers the single startup project and every profile, the user file\'s marked', () => {
        const items = startupPickItems(path.join(root, 'src', 'Web', 'Web.csproj'), files, undefined);

        expect(items.map(({ label, description, detail, choice }) => ({ label, description, detail, choice }))).toEqual([
            { label: 'Single: Web', description: '(current)', detail: undefined, choice: { kind: 'single' } },
            { label: 'Team', description: undefined, detail: 'Web, Worker (without debugging)', choice: { kind: 'profile', ref: { name: 'Team', source: 'shared' } } },
            { label: 'Mine', description: 'user file', detail: 'Starts no project', choice: { kind: 'profile', ref: { name: 'Mine', source: 'user' } } },
        ]);
    });

    it('marks the active profile and leaves out the single entry without a startup project', () => {
        const items = startupPickItems(undefined, files, { name: 'Mine', source: 'user' });

        expect(items.map(item => [item.label, item.description])).toEqual([['Team', undefined], ['Mine', 'user file (current)']]);
    });
});
