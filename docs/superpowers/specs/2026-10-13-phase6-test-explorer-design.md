# Phase 6: Test Explorer — Design

Test discovery, run and debug in VS Code's Test Explorer for test projects on **Microsoft.Testing.Platform** (MTP): xUnit v3, MSTest runner (`EnableMSTestRunner`), TUnit, NUnit with `EnableNUnitRunner`. Classic VSTest projects (xUnit v2, NUnit/MSTest adapters) are not supported yet (later roadmap item).

## Findings (SDK 10.0.111, xunit.v3 3.2.2, MSTest 4)

- Every MTP test app speaks the IDE protocol: start it as `dotnet <TargetPath> --server --client-host 127.0.0.1 --client-port <port>`; it connects to a TCP server the IDE listens on and talks JSON-RPC 2.0 with `Content-Length` framing (like LSP). xUnit v3 does this with default settings (`UseMicrosoftTestingPlatformRunner` not needed).
- Client → server: `initialize` `{ processId, clientInfo, capabilities: { testing: { debuggerProvider: false } } }`; `testing/discoverTests` `{ runId }`; `testing/runTests` `{ runId, tests?: [{ uid, display-name }] }` (all tests without `tests`); `exit` notification. Requests return when the session is finished.
- Server → client notifications: `testing/testUpdates/tests` `{ runId, changes: [{ node, parent }] }` and `client/log` `{ level, message }`; `telemetry/update` is ignored.
- Nodes: `uid` (stable), `display-name`, `node-type` (`action` for tests), `execution-state` (`discovered`, `in-progress`, `passed`, `failed`, `skipped`, `timed-out`, `error`, `cancelled`), `location.file`, `location.line-start`/`line-end`, `location.type` (class FQN), `location.method` (`Positive(System.Int32)`), `time.duration-ms`, `error.message`, `error.stacktrace`, `assert.expected`, `assert.actual`, optional `standardOutput`/`standardError`.
- Parameterized cases are separate nodes with the same `location.method` (xUnit `X3.Math.MathTests.Positive(x: 1)`, MSTest `Positive (1)`).
- `runTests` with `debug: true` doesn't ask for a debugger; debugging means starting the test app in the debugger with the server arguments.
- MSBuild tells test apps apart: `IsTestingPlatformApplication` is `true` for MTP apps; `TargetPath` is the dll.

Fixtures: `src/__fixtures__/testing-platform/{X3,MR}.jsonl` (all messages of discover + run for an xUnit v3 and an MSTest runner app, paths under `/repo`).

## 1. Test projects

Projects whose file references `xunit.v3`, `MSTest`, `MSTest.Sdk`, `TUnit`, `NUnit`, `Microsoft.Testing.Platform`, `Microsoft.NET.Test.Sdk` or sets `IsTestProject`/`EnableMSTestRunner` are candidates. For each, `dotnet msbuild -getProperty:IsTestingPlatformApplication -getProperty:TargetPath -property:Configuration=<active>` (Phase 3's build configuration). MTP apps get a project item; VSTest projects are logged to the output channel ("VSTest projects are not supported yet").

## 2. Tree

`vscode.tests.createTestController('shinobi-dotnet-tests', '.NET Tests')`: project → namespace → class → method → cases. The namespace and class come from `location.type`, the method name from `location.method` without its signature. A method with one node is the test itself (item id = node uid); a method with several nodes gets a child per node (labelled with the case part of `display-name`). Items carry `uri` and `range` from `location.file`/`line-start`. Discovery replaces a project's children.

## 3. Discovery

- Activation (and solution load): projects whose `TargetPath` exists, no build.
- After a build: when a `shinobi-dotnet` build task or `StartupPreBuild` ends, projects whose `TargetPath` is newer than at their last discovery.
- Refresh button (`refreshHandler`): build the test projects, then discover them.

## 4. Run

Run profile (default): group the requested items by project (all projects without `include`), build each project (`dotnet build <project> --configuration <active>`), start the app with the server arguments, `initialize`, `testing/runTests` with the uids of the requested leaves (none for a whole project), map updates: `in-progress` → `started`, `passed` → `passed(duration)`, `failed`/`timed-out`/`error` → `failed`/`errored` with a `TestMessage` (`error.message`, `expected`/`actual` when present, location = test location; stack trace appended), `skipped` → `skipped`. `client/log` messages of level Information and above, `standardOutput` and the app's stderr go to `run.appendOutput` (`\n` → `\r\n`). Cancellation sends `exit` and kills the process. Nodes the tree doesn't know yet (new tests) are added under their class.

## 5. Debug

Debug profile: same as run, but the app is started with `vscode.debug.startDebugging` (`type: coreclr`, `request: launch`, `program: <TargetPath>`, `args: [--server, --client-host, 127.0.0.1, --client-port, <port>]`, `cwd` = project dir); once it connects the tests run, then the debug session is stopped.

## 6. Errors

Build failure: the requested tests are `errored` with "Build failed, see the Problems panel". No connection within 30 s: `errored` with the app's output. Discovery failures are logged and leave the project's previous children.

## 7. C# extension

Its "Run Test | Debug Test" code lenses stay; README mentions `"dotnet.codeLens.enableTestsCodeLens": false` to rely on the Test Explorer's gutter icons only.

## 8. Tests

Unit: framing (split and joined messages), request/response matching and notifications; tree building and result mapping from the fixtures; test project candidate detection. Integration (skipped without dotnet or when the packages can't be restored): build an xUnit v3 and an MSTest runner project in a temporary folder, discover and run them through the client.
