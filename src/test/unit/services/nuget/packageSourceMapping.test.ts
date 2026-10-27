import { mappedSources, mergeSourceMappings, parseSourceMapping } from '../../../../services/nuget/packageSourceMapping';

const config = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="Company Feed" value="https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json" />
  </packageSources>
  <!-- <packageSourceMapping><packageSource key="old"><package pattern="*" /></packageSource></packageSourceMapping> -->
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
      <package pattern="Microsoft.*" />
    </packageSource>
    <packageSource key='Company Feed'>
      <package pattern="Company.*" />
      <package pattern="Microsoft.Company.Special" />
    </packageSource>
  </packageSourceMapping>
</configuration>`;

describe('Package Source Mapping', () => {
    it('reads the mapping of a NuGet.Config, comments and quotes handled', () => {
        expect(parseSourceMapping(config)).toEqual({
            'nuget.org': ['*', 'Microsoft.*'],
            'Company Feed': ['Company.*', 'Microsoft.Company.Special'],
        });
        expect(parseSourceMapping('<configuration><packageSources /></configuration>')).toEqual({});
        expect(parseSourceMapping('<configuration><packageSourceMapping><packageSource key="a" /></packageSourceMapping></configuration>')).toEqual({ a: [] });
    });

    it('lets the most specific pattern decide, an exact id above a prefix', () => {
        const mapping = parseSourceMapping(config);
        expect(mappedSources(mapping, 'Newtonsoft.Json')).toEqual(['nuget.org']);
        expect(mappedSources(mapping, 'Company.Core')).toEqual(['Company Feed']);
        expect(mappedSources(mapping, 'company.core')).toEqual(['Company Feed']);
        expect(mappedSources(mapping, 'Microsoft.Extensions.Logging')).toEqual(['nuget.org']);
        expect(mappedSources(mapping, 'Microsoft.Company.Special')).toEqual(['Company Feed']);
    });

    it('allows every source that has the winning pattern, and none when nothing matches', () => {
        expect(mappedSources({ a: ['Shared.*'], b: ['Shared.*'], c: ['*'] }, 'Shared.Lib')).toEqual(['a', 'b']);
        expect(mappedSources({ a: ['Only.*'] }, 'Other')).toEqual([]);
    });

    it('is undefined when no mapping is configured, so any source may provide', () => {
        expect(mappedSources({}, 'Anything')).toBeUndefined();
    });

    it('combines the mappings of several config files', () => {
        const merged = mergeSourceMappings([{ 'nuget.org': ['*'] }, { 'NuGet.org': ['Extra.*'], birs: ['Birs.*'] }]);
        expect(merged).toEqual({ 'nuget.org': ['*', 'Extra.*'], birs: ['Birs.*'] });
    });
});
