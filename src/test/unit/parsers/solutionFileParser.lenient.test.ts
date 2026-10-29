// The .sln parser reads every Project( block before Global, like MSBuild (external review 2026-10-29)
import { SolutionFileParser } from '../../../parsers/solutionFileParser';

const CS = '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}';
const project = (name: string) => `Project("${CS}") = "${name}", "${name}\\${name}.csproj", "{${name.length}0000000-0000-0000-0000-000000000000}"`;
const parse = (lines: string[]) => SolutionFileParser.parse(lines.join('\n'), '/nonexistent').then(solution => solution.projects.map(p => p.name));

describe('SolutionFileParser with unexpected lines', () => {
    it('keeps the projects after a stray comment between two blocks', async () => {
        expect(await parse([project('A'), 'EndProject', '# a comment', project('BB'), 'EndProject', 'Global', 'EndGlobal'])).toEqual(['A', 'BB']);
    });

    it('keeps the next project when EndProject is missing', async () => {
        expect(await parse([project('A'), project('BB'), 'EndProject', project('CCC'), 'EndProject', 'Global', 'EndGlobal'])).toEqual(['A', 'BB', 'CCC']);
    });

    it('does not take Global for part of an unfinished project', async () => {
        expect(await parse([project('A'), 'Global', 'EndGlobal'])).toEqual(['A']);
    });
});
