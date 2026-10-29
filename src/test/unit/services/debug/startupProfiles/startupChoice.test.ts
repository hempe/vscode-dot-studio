import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const contexts = new Map<string, unknown>();

jest.mock('vscode', () => ({
    commands: {
        executeCommand: async (command: string, key: string, value: unknown) => {
            if (command === 'setContext') {
                contexts.set(key, value);
            }
        },
    },
}), { virtual: true });

import { readStartupProfiles, StartupChoice, STARTUP_PROFILES_CONTEXT, writeStartupProfiles } from '../../../../services/startupProfiles/startupChoice';
import { StartupProfile } from '../../../../services/startupProfiles/slnLaunch';

class Memento {
    private readonly values = new Map<string, unknown>();
    get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

const PROFILES = '[{"Name":"Both","Projects":[{"Path":"Api\\\\Api.csproj","Action":"Start"},{"Path":"Worker\\\\Worker.csproj","Action":"StartWithoutDebugging"}]}]';

describe('StartupChoice', () => {
    let dir: string;
    let solutionPath: string;
    let fired: number;
    let listener: { dispose(): void };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-choice-'));
        solutionPath = path.join(dir, 'Shop.sln');
        StartupChoice.initialize(new Memento() as any);
        fired = 0;
        listener = StartupChoice.onDidChange(() => fired++);
        contexts.clear();
    });

    afterEach(() => {
        listener.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('is the single startup project until a profile is chosen', () => {
        expect(StartupChoice.resolve(solutionPath)).toEqual({ kind: 'single' });
        expect(StartupChoice.activeProfileName(solutionPath)).toBeUndefined();
    });

    it('reads the active profile from its file and remembers the single project to go back to', async () => {
        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch.user'), PROFILES);
        const single = { projectPath: path.join(dir, 'Api', 'Api.csproj'), framework: 'net10.0', launchProfile: 'https' };

        await StartupChoice.chooseProfile(solutionPath, { name: 'Both', source: 'user' }, single);

        const resolved = StartupChoice.resolve(solutionPath);
        expect(resolved.kind).toBe('profile');
        expect(resolved.kind === 'profile' && resolved.profile.projects.map(project => project.action)).toEqual(['Start', 'StartWithoutDebugging']);
        expect(StartupChoice.activeProfileName(solutionPath)).toBe('Both');
        expect(StartupChoice.rememberedSingle(solutionPath)).toEqual(single);
        expect(fired).toBe(1);

        // Another profile keeps the remembered single project
        await StartupChoice.chooseProfile(solutionPath, { name: 'Other', source: 'user' });
        expect(StartupChoice.rememberedSingle(solutionPath)).toEqual(single);
    });

    it('falls back to the single startup project when the file or the profile is gone, and comes back with it', async () => {
        await StartupChoice.chooseProfile(solutionPath, { name: 'Both', source: 'shared' });
        expect(StartupChoice.resolve(solutionPath)).toEqual({ kind: 'single' });

        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch'), '[{"Name":"Renamed","Projects":[]}]');
        expect(StartupChoice.resolve(solutionPath)).toEqual({ kind: 'single' });

        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch'), PROFILES);
        expect(StartupChoice.resolve(solutionPath).kind).toBe('profile');
        // The user file is another file
        expect(StartupChoice.profileRef(solutionPath)).toEqual({ name: 'Both', source: 'shared' });
    });

    it('reports a file that cannot be parsed instead of falling back', async () => {
        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch'), '[{"Name":');
        await StartupChoice.chooseProfile(solutionPath, { name: 'Both', source: 'shared' });

        const resolved = StartupChoice.resolve(solutionPath);
        expect(resolved).toEqual({ kind: 'unreadable', ref: { name: 'Both', source: 'shared' }, error: expect.stringContaining('not valid JSON') });
    });

    it('goes back to the single startup project, and does nothing without a profile', async () => {
        await StartupChoice.chooseSingle(solutionPath);
        expect(fired).toBe(0);

        await StartupChoice.chooseProfile(solutionPath, { name: 'Both', source: 'shared' }, { projectPath: 'Api.csproj' });
        await StartupChoice.chooseSingle(solutionPath);
        expect(fired).toBe(2);
        expect(StartupChoice.profileRef(solutionPath)).toBeUndefined();
        expect(StartupChoice.rememberedSingle(solutionPath)).toEqual({ projectPath: 'Api.csproj' });
    });

    it('keeps the choice per solution', async () => {
        await StartupChoice.chooseProfile(solutionPath, { name: 'Both', source: 'shared' });
        expect(StartupChoice.profileRef(path.join(dir, 'Other.sln'))).toBeUndefined();
    });

    it('sets the context key while a profile file exists', () => {
        StartupChoice.updateContext(solutionPath);
        expect(contexts.get(STARTUP_PROFILES_CONTEXT)).toBe(false);

        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch.user'), '[]');
        StartupChoice.updateContext(solutionPath);
        expect(contexts.get(STARTUP_PROFILES_CONTEXT)).toBe(true);
    });
});

describe('reading and writing the profile files', () => {
    let dir: string;
    let solutionPath: string;
    const profile: StartupProfile = { name: 'Web', extra: {}, projects: [{ path: 'Api/Api.csproj', action: 'Start', extra: {} }] };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-files-'));
        solutionPath = path.join(dir, 'Shop.slnx');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('reads both files, a missing one as empty and a broken one with a readable error', () => {
        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch'), PROFILES);
        fs.writeFileSync(path.join(dir, 'Shop.slnLaunch.user'), '{ "Name": "not an array" }');

        const files = readStartupProfiles(solutionPath);

        expect(files.shared.exists).toBe(true);
        expect(files.shared.error).toBeUndefined();
        expect(files.shared.profiles.map(p => p.name)).toEqual(['Both']);
        expect(files.user).toEqual(expect.objectContaining({ exists: true, profiles: [], error: expect.stringContaining('JSON array') }));

        fs.rmSync(path.join(dir, 'Shop.slnLaunch.user'));
        expect(readStartupProfiles(solutionPath).user).toEqual({ path: path.join(dir, 'Shop.slnLaunch.user'), exists: false, profiles: [] });
    });

    it('writes a new file in Visual Studio\'s format', () => {
        writeStartupProfiles(solutionPath, 'shared', [profile]);

        expect(fs.readFileSync(path.join(dir, 'Shop.slnLaunch'), 'utf8')).toBe(
            '[\n  {\n    "Name": "Web",\n    "Projects": [\n      {\n        "Path": "Api\\\\Api.csproj",\n        "Action": "Start"\n      }\n    ]\n  }\n]\n');
    });

    it('never writes over a file that cannot be parsed', () => {
        const userFile = path.join(dir, 'Shop.slnLaunch.user');
        fs.writeFileSync(userFile, '[ broken');

        expect(() => writeStartupProfiles(solutionPath, 'user', [profile])).toThrow(/Shop\.slnLaunch\.user was not changed: .*not valid JSON/);
        expect(fs.readFileSync(userFile, 'utf8')).toBe('[ broken');
    });
});
