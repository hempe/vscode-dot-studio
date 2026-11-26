/**
 * The environment of the extension's build tasks: MSBuild's classic console logger, whose one line per message `$msCompile` reads
 * (with `-consoleLoggerParameters:...;ForceNoAlign`, so long paths are not wrapped at the console width, which ConPTY on Windows turns
 * into real line breaks). The terminal logger ignores those parameters; as an environment variable this is ignored by SDKs before `-tl`.
 */
export const BUILD_ENV = { MSBUILDTERMINALLOGGER: 'off' };
