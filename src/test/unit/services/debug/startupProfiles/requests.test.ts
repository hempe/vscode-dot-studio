import { planRequest, toEntry } from '../../../../services/startupProfiles/requests';
import { StartupProfile } from '../../../../services/startupProfiles/slnLaunch';
import { StartupProfileEntry } from '../../../../types/startupProjects';

const profile = (name: string, ...projects: Array<[string, StartupProfile['projects'][number]['action'], Record<string, unknown>?]>): StartupProfile => ({
    name, extra: {}, projects: projects.map(([path, action, extra]) => ({ path, action, extra: extra ?? {} })),
});
const entry = (name: string, shared: boolean, ...projects: StartupProfileEntry['projects']): StartupProfileEntry => ({ name, shared, projects });
const files = (shared: StartupProfile[] = [], user: StartupProfile[] = []) => ({ shared: { profiles: shared }, user: { profiles: user } });

describe('startup profile requests', () => {
    it('shows DebugTarget as the launch profile', () => {
        expect(toEntry(profile('P', ['a/A.csproj', 'Start', { DebugTarget: 'https' }], ['b/B.csproj', 'None']), 'user')).toEqual({
            name: 'P', shared: false,
            projects: [{ path: 'a/A.csproj', action: 'Start', launchProfile: 'https' }, { path: 'b/B.csproj', action: 'None' }],
        });
    });

    it('adds a new profile to the user file and makes it active; None rows are not written', () => {
        const plan = planRequest(files(), {
            type: 'applyProfile',
            profile: entry(' Startup ', false, { path: 'Web/Web.csproj', action: 'Start', launchProfile: 'https' }, { path: 'Lib/Lib.csproj', action: 'None' }),
        });
        expect(plan.active).toEqual({ name: 'Startup', source: 'user' });
        expect(plan.writes).toEqual([{ source: 'user', profiles: [profile('Startup', ['Web/Web.csproj', 'Start', { DebugTarget: 'https' }])] }]);
    });

    it('keeps the order of the rows, unknown keys, listed None rows and projects the tab did not list', () => {
        const before = { ...profile('P', ['a/A.csproj', 'Start', { Other: 1, DebugTarget: 'old' }], ['gone/Gone.csproj', 'Start'], ['n/N.csproj', 'None']), extra: { Id: 7 } };
        const plan = planRequest(files([before]), {
            type: 'applyProfile', original: { name: 'P', shared: true },
            profile: entry('P', true, { path: 'b/B.csproj', action: 'StartWithoutDebugging' }, { path: 'A/a.csproj', action: 'Start' }, { path: 'n/N.csproj', action: 'None' }),
        });
        expect(plan.writes).toHaveLength(1);
        expect(plan.writes[0].profiles[0]).toEqual({
            name: 'P', extra: { Id: 7 },
            projects: [
                { path: 'b/B.csproj', action: 'StartWithoutDebugging', extra: {} },
                { path: 'A/a.csproj', action: 'Start', extra: { Other: 1 } },
                { path: 'n/N.csproj', action: 'None', extra: {} },
                { path: 'gone/Gone.csproj', action: 'Start', extra: {} },
            ],
        });
    });

    it('renames in place', () => {
        const plan = planRequest(files([profile('A'), profile('B'), profile('C')]), {
            type: 'applyProfile', original: { name: 'B', shared: true }, profile: entry('B2', true),
        });
        expect(plan.writes[0].profiles.map(p => p.name)).toEqual(['A', 'B2', 'C']);
        expect(plan.active).toEqual({ name: 'B2', source: 'shared' });
    });

    it('moves between the files: target first, then the other without it', () => {
        const plan = planRequest(files([profile('A', ['a.csproj', 'Start'])], [profile('U')]), {
            type: 'applyProfile', original: { name: 'A', shared: true }, profile: entry('A', false, { path: 'a.csproj', action: 'Start' }),
        });
        expect(plan.writes.map(w => [w.source, w.profiles.map(p => p.name)])).toEqual([['user', ['U', 'A']], ['shared', []]]);
        expect(plan.active).toEqual({ name: 'A', source: 'user' });
    });

    it('rejects an empty name and a name another profile has, in either file', () => {
        expect(() => planRequest(files(), { type: 'applyProfile', profile: entry('  ', true) })).toThrow('name');
        expect(() => planRequest(files([profile('Dev')]), { type: 'applyProfile', profile: entry('dev', false) })).toThrow('already a profile named "Dev"');
        expect(() => planRequest(files([], [profile('Dev')]), { type: 'applyProfile', profile: entry('Dev', true) })).toThrow('(user file)');
    });

    it('writes nothing for an unreadable file', () => {
        const broken = { shared: { profiles: [], error: 'not valid JSON' }, user: { profiles: [] } };
        expect(() => planRequest(broken, { type: 'applyProfile', profile: entry('P', true) })).toThrow('nothing was changed: not valid JSON');
        expect(() => planRequest(broken, { type: 'deleteProfile', name: 'P', shared: true })).toThrow('cannot be read');
        // The readable file is not touched either when the profile moves out of the unreadable one
        expect(() => planRequest(broken, { type: 'applyProfile', original: { name: 'P', shared: true }, profile: entry('P', false) })).toThrow('cannot be read');
        // An unreadable file the request does not need does not matter
        expect(planRequest(broken, { type: 'applyProfile', profile: entry('P', false) }).writes).toHaveLength(1);
    });

    it('deletes a profile', () => {
        const plan = planRequest(files([profile('A'), profile('B')]), { type: 'deleteProfile', name: 'A', shared: true });
        expect(plan).toEqual({ writes: [{ source: 'shared', profiles: [profile('B')] }] });
        expect(() => planRequest(files(), { type: 'deleteProfile', name: 'A', shared: true })).toThrow('no profile named');
    });
});
