import * as fs from 'fs';
import * as path from 'path';
import { readSlnLaunch, renderSlnLaunch, slnLaunchPaths, StartupProfile } from '../../../../../services/debug/startupProfiles/slnLaunch';

const fixture = fs.readFileSync(path.join(__dirname, '../../../../../__fixtures__/startup-profiles/OrchardCore.slnLaunch'), 'utf8');

describe('readSlnLaunch', () => {
    it('reads the Microsoft Learn example with forward-slash project paths', () => {
        const { profiles } = readSlnLaunch(fixture);
        expect(profiles).toEqual([{
            name: 'Feature Profile',
            extra: {},
            projects: [
                { path: 'src/OrchardCore.Cms.Web/OrchardCore.Cms.Web.csproj', action: 'Start', extra: {} },
                { path: 'src/OrchardCore.Modules/OrchardCore.Media/OrchardCore.Media.csproj', action: 'StartWithoutDebugging', extra: {} },
                { path: 'src/OrchardCore.Modules/OrchardCore.Search/OrchardCore.Search.csproj', action: 'None', extra: {} }
            ]
        }]);
    });

    it('treats an empty file, whitespace and [] as an empty list', () => {
        expect(readSlnLaunch('').profiles).toEqual([]);
        expect(readSlnLaunch(' \r\n').profiles).toEqual([]);
        expect(readSlnLaunch('[]').profiles).toEqual([]);
    });

    it('keeps unknown keys of profiles and projects in extra', () => {
        const text = '[{"Name":"A","Shared":true,"Projects":[{"Path":"a.csproj","Action":"Start","DebugTarget":"https"}]}]';
        const [profile] = readSlnLaunch(text).profiles;
        expect(profile.extra).toEqual({ Shared: true });
        expect(profile.projects[0].extra).toEqual({ DebugTarget: 'https' });
    });

    it('maps an unknown action to None and keeps the raw string in extra.Action', () => {
        const [profile] = readSlnLaunch('[{"Name":"A","Projects":[{"Path":"a.csproj","Action":"Profile"}]}]').profiles;
        expect(profile.projects[0].action).toBe('None');
        expect(profile.projects[0].extra).toEqual({ Action: 'Profile' });
    });

    it('throws a readable error for malformed JSON and wrong shapes', () => {
        expect(() => readSlnLaunch('[{"Name": ')).toThrow(/\.slnLaunch/);
        expect(() => readSlnLaunch('{}')).toThrow(/array/);
        expect(() => readSlnLaunch('[{"Name":"A","Projects":[{"Action":"Start"}]}]')).toThrow(/Path/);
    });

    it('ignores a byte order mark', () => {
        expect(readSlnLaunch('\uFEFF[]').profiles).toEqual([]);
    });
});

describe('renderSlnLaunch', () => {
    it('round-trips the fixture to identical text', () => {
        expect(renderSlnLaunch(fixture, readSlnLaunch(fixture).profiles)).toBe(fixture);
    });

    it('round-trips CRLF, 4-space and tab files and BOM', () => {
        const crlf = fixture.replace(/\n/g, '\r\n');
        expect(renderSlnLaunch(crlf, readSlnLaunch(crlf).profiles)).toBe(crlf);
        const four = fixture.replace(/^( +)/gm, m => m.repeat(2));
        expect(renderSlnLaunch(four, readSlnLaunch(four).profiles)).toBe(four);
        const tabs = fixture.replace(/^( +)/gm, m => '\t'.repeat(m.length / 2));
        expect(renderSlnLaunch(tabs, readSlnLaunch(tabs).profiles)).toBe(tabs);
        const bom = '\uFEFF' + fixture;
        expect(renderSlnLaunch(bom, readSlnLaunch(bom).profiles)).toBe(bom);
    });

    it('keeps the file without a trailing newline as it was', () => {
        const text = fixture.trimEnd();
        expect(renderSlnLaunch(text, readSlnLaunch(text).profiles)).toBe(text);
    });

    it('writes a new file with 2 spaces, LF, backslash paths and a final newline', () => {
        const profiles: StartupProfile[] = [{ name: 'P', extra: {}, projects: [{ path: 'src/Web/Web.csproj', action: 'Start', extra: {} }] }];
        expect(renderSlnLaunch(undefined, profiles)).toBe(
            '[\n  {\n    "Name": "P",\n    "Projects": [\n      {\n        "Path": "src\\\\Web\\\\Web.csproj",\n        "Action": "Start"\n      }\n    ]\n  }\n]\n');
    });

    it('renders an empty list as []', () => {
        expect(renderSlnLaunch(undefined, [])).toBe('[]\n');
    });

    it('keeps an existing entry\'s own path spelling and writes new ones with backslashes', () => {
        const text = '[{"Name":"A","Projects":[{"Path":"src/a/a.csproj","Action":"Start"}]}]';
        const { profiles } = readSlnLaunch(text);
        profiles[0].projects.push({ path: 'src/b/b.csproj', action: 'None', extra: {} });
        const out = JSON.parse(renderSlnLaunch(text, profiles));
        expect(out[0].Projects.map((p: { Path: string }) => p.Path)).toEqual(['src/a/a.csproj', 'src\\b\\b.csproj']);
    });

    it('preserves unknown keys in their original position and applies changes', () => {
        const text = '[\n  {\n    "Shared": true,\n    "Name": "A",\n    "Projects": [\n      {\n        "DebugTarget": "https",\n        "Path": "a.csproj",\n        "Action": "Start"\n      }\n    ]\n  }\n]\n';
        const { profiles } = readSlnLaunch(text);
        profiles[0].projects[0].action = 'None';
        const out = renderSlnLaunch(text, profiles);
        expect(out).toBe(text.replace('"Start"', '"None"'));
    });

    it('writes a raw unknown action back while it stays None, and lets a change win', () => {
        const text = '[{"Name":"A","Projects":[{"Path":"a.csproj","Action":"Profile"}]}]';
        const { profiles } = readSlnLaunch(text);
        expect(JSON.parse(renderSlnLaunch(text, profiles))[0].Projects[0].Action).toBe('Profile');
        profiles[0].projects[0].action = 'Start';
        expect(JSON.parse(renderSlnLaunch(text, profiles))[0].Projects[0]).toEqual({ Path: 'a.csproj', Action: 'Start' });
    });

    it('throws for malformed existing text instead of starting from nothing', () => {
        expect(() => renderSlnLaunch('[{"Name":', [])).toThrow(/\.slnLaunch/);
    });
});

describe('slnLaunchPaths', () => {
    it('puts the shared and the user file next to the solution', () => {
        expect(slnLaunchPaths(path.join('/work', 'Shop.sln'))).toEqual({
            shared: path.join('/work', 'Shop.slnLaunch'),
            user: path.join('/work', 'Shop.slnLaunch.user')
        });
        expect(slnLaunchPaths(path.join('/work', 'Shop.slnx')).shared).toBe(path.join('/work', 'Shop.slnLaunch'));
    });
});
