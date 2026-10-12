import { parseJsonc, upsertArrayItem } from '../../../core/jsonc';

const isStartup = (item: any) => item?.name === 'Startup';

describe('parseJsonc', () => {
    it('parses comments and trailing commas', () => {
        const result = parseJsonc(`{
            // comment
            "version": "0.2.0", /* block */
            "configurations": [],
        }`);

        expect(result.errors).toEqual([]);
        expect(result.value).toEqual({ version: '0.2.0', configurations: [] });
    });

    it('reports syntax errors', () => {
        const result = parseJsonc('{ "configurations": [ }');

        expect(result.errors.length).toBeGreaterThan(0);
    });
});

describe('upsertArrayItem', () => {
    const startup = { name: 'Startup', type: 'coreclr' };

    it('keeps comments and other entries when inserting', () => {
        const text = `{
    // my configs
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Attach", // keep me
            "type": "coreclr",
        },
    ]
}`;

        const updated = upsertArrayItem(text, 'configurations', isStartup, startup, 'first');

        expect(updated).toContain('// my configs');
        expect(updated).toContain('// keep me');
        expect(parseJsonc(updated).value.configurations.map((c: any) => c.name)).toEqual(['Startup', 'Attach']);
    });

    it('replaces an existing entry in place', () => {
        const text = `{
    "configurations": [
        { "name": "Attach" },
        { "name": "Startup", "type": "old" }, // startup
        { "name": "Other" }
    ]
}`;

        const updated = upsertArrayItem(text, 'configurations', isStartup, startup, 'first');
        const configs = parseJsonc(updated).value.configurations;

        expect(configs.map((c: any) => c.name)).toEqual(['Attach', 'Startup', 'Other']);
        expect(configs[1].type).toBe('coreclr');
        expect(updated).toContain('// startup');
    });

    it('appends when position is last', () => {
        const text = '{ "tasks": [ { "label": "build" } ] }';

        const updated = upsertArrayItem(text, 'tasks', (t: any) => t?.label === 'StartupPreBuild', { label: 'StartupPreBuild' }, 'last');

        expect(parseJsonc(updated).value.tasks.map((t: any) => t.label)).toEqual(['build', 'StartupPreBuild']);
    });

    it('creates the array when it is missing', () => {
        const updated = upsertArrayItem('{ "version": "0.2.0" }', 'configurations', isStartup, startup, 'first');

        expect(parseJsonc(updated).value).toEqual({ version: '0.2.0', configurations: [startup] });
    });

    it('leaves the text unchanged when the entry is already up to date', () => {
        const text = `{
    "configurations": [
        { "name": "Startup", "type": "coreclr" }
    ]
}`;

        expect(upsertArrayItem(text, 'configurations', isStartup, startup, 'first')).toBe(text);
    });

    it('keeps tab indentation', () => {
        const text = '{\n\t"configurations": [\n\t\t{ "name": "Attach" }\n\t]\n}';

        const updated = upsertArrayItem(text, 'configurations', isStartup, startup, 'first');

        expect(updated).toMatch(/\n\t\t\{/);
        expect(updated).not.toMatch(/\n {2}/);
    });
});
