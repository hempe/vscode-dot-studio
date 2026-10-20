import { parseTargetFrameworks } from '../../../parsers/targetFrameworks';

const project = (properties: string) => `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>${properties}</PropertyGroup></Project>`;

describe('parseTargetFrameworks', () => {
    it('reads one framework', async () => {
        expect(await parseTargetFrameworks(project('<TargetFramework>net48</TargetFramework>'))).toEqual(['net48']);
    });

    it('reads several, trimmed', async () => {
        expect(await parseTargetFrameworks(project('<TargetFrameworks>net48; net10.0;</TargetFrameworks>'))).toEqual(['net48', 'net10.0']);
    });

    it('has none when the project declares none', async () => {
        expect(await parseTargetFrameworks(project('<OutputType>Exe</OutputType>'))).toEqual([]);
    });
});
