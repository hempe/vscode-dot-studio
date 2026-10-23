import { DEFAULT_RUN_SETTINGS, testingPlatformRunSettings, vstestRunSettings } from '../../../../services/testing/runSettings';

const team = `<?xml version="1.0" encoding="utf-8"?>
<!-- the team's settings -->
<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
    <DesignMode>false</DesignMode>
    <EnvironmentVariables>
      <TEAM_VAR>yes</TEAM_VAR>
      <CONNECTION>a=1&amp;b=2</CONNECTION>
    </EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat Code Coverage" />
    </DataCollectors>
  </DataCollectionRunSettings>
  <LoggerRunSettings><Loggers><Logger friendlyName="trx" /></Loggers></LoggerRunSettings>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>
`;

const squash = (xml: string) => xml.replace(/>\s+</g, '><').trim();

describe('run settings for VSTest', () => {
    test('keeps RunConfiguration, TestRunParameters and adapter sections; leaves out data collectors and loggers; DesignMode is ours', () => {
        expect(squash(vstestRunSettings(team)!)).toBe(squash(`<RunSettings>
  <RunConfiguration><DesignMode>true</DesignMode>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
    <EnvironmentVariables>
      <TEAM_VAR>yes</TEAM_VAR>
      <CONNECTION>a=1&amp;b=2</CONNECTION>
    </EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>`));
    });

    test('adds RunConfiguration when the file has none, or only an empty one', () => {
        expect(vstestRunSettings('<RunSettings><TestRunParameters /></RunSettings>'))
            .toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration><TestRunParameters /></RunSettings>');
        expect(vstestRunSettings('<RunSettings><RunConfiguration /></RunSettings>'))
            .toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration></RunSettings>');
        expect(vstestRunSettings('\uFEFF<RunSettings></RunSettings>')).toBe(DEFAULT_RUN_SETTINGS);
    });

    test('elements in comments are not settings', () => {
        expect(vstestRunSettings('<RunSettings><!-- <RunConfiguration><MaxCpuCount>4</MaxCpuCount></RunConfiguration> --></RunSettings>')).toBe(DEFAULT_RUN_SETTINGS);
    });

    test('refuses what is not a RunSettings document', () => {
        expect(vstestRunSettings('')).toBeUndefined();
        expect(vstestRunSettings('<Project><PropertyGroup /></Project>')).toBeUndefined();
        expect(vstestRunSettings('<RunSettings><RunConfiguration>')).toBeUndefined();
    });
});

describe('run settings for Microsoft.Testing.Platform apps', () => {
    test('the environment variables go to the process, the rest to --settings, without DesignMode, collectors and loggers', () => {
        const settings = testingPlatformRunSettings(team)!;
        expect(settings.environment).toEqual({ TEAM_VAR: 'yes', CONNECTION: 'a=1&b=2' });
        expect(squash(settings.settings)).toBe(squash(`<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>`));
    });

    test('no environment variables, no RunSettings document', () => {
        expect(testingPlatformRunSettings('<RunSettings><TestRunParameters /></RunSettings>')!.environment).toEqual({});
        expect(testingPlatformRunSettings('<Project />')).toBeUndefined();
    });
});
