import { parseProjectConfigurations } from '../../../parsers/projectConfigurations';

describe('parseProjectConfigurations', () => {
    it('reads the declared lists', async () => {
        const xml = '<Project><PropertyGroup><Configurations>Debug;Release;Staging</Configurations><Platforms>AnyCPU; x64</Platforms></PropertyGroup></Project>';
        expect(await parseProjectConfigurations(xml)).toEqual({ configurations: ['Debug', 'Release', 'Staging'], platforms: ['AnyCPU', 'x64'] });
    });

    it('defaults when nothing is declared', async () => {
        expect(await parseProjectConfigurations('<Project><PropertyGroup/></Project>')).toEqual({ configurations: ['Debug', 'Release'], platforms: ['Any CPU'] });
    });

    it('defaults when the XML cannot be read', async () => {
        expect(await parseProjectConfigurations('<Project><oops')).toEqual({ configurations: ['Debug', 'Release'], platforms: ['Any CPU'] });
    });
});
