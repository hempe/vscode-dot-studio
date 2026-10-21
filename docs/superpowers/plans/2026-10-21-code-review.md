# Code Review of the Whole Code Base: Plan

> **For agentic workers:** this is a review plan, not a feature plan. Run it with superpowers:subagent-driven-development or the Workflow tool, one reviewer per area, findings verified by a second pass. Fixes are separate tasks written after the findings are triaged.

**Goal:** a systematic review of the extension once the planned features (Phases 19–21) are in, ideally also a first pass before them for the older areas, so that bugs, dead code, duplicated logic, weak tests and doc drift are found and fixed in one go.

**When:** after Phase 21, or earlier for areas that are finished and not touched by the open phases (NuGet service layer, templates, publish, tests, startup profiles, configuration manager, code cleanup, namespaces). Reviewing before changing areas wastes effort; reviewing after the large changes finds the interactions.

## Areas (one reviewer each, in this order)

1. **Solution model and file formats:** `core/Solution.ts`, `core/Project.ts`, `handlers/`, `parsers/` (.sln line edits, .slnx editor, project file editor), `services/projectItems/`, `unloadedProjects.ts`. Focus: edits that corrupt files, CRLF/LF, Windows paths and case, concurrency between watchers and edits.
2. **Solution Explorer host side:** `webview/providers/`, `services/solutionTreeService.ts`, `solutionExpansionService.ts`, `solutionActionService.ts` (very large; split it if the review shows it should be), node ids, message handling. Focus: dead messages, error handling, refresh loops.
3. **Webview code:** `webview/solution-view`, `nuget-view`, `error-list`, `publish-view`, `configuration-view`, `startup-view`, `template-wizard`. Focus: node ids stay opaque, no host imports, accessibility (keyboard, focus, ARIA), re-render cost with large trees.
4. **NuGet:** `services/nuget/`, the V3 client, caches, credentials and feeds. Focus: the private feed and credential handling (secrets in logs or temp files), error paths, Central Package Management once done.
5. **Run, debug and tests:** `debugConfigService`, `startupProfiles`, `attach`, `hotReload`, `devCert`, `testing/`, task provider. Focus: process lifetime (leaked terminals and child processes), `launch.json` edits, per-OS commands.
6. **Templates, publish, service references, code cleanup, namespaces:** the remaining services. Focus: command construction (quoting, injection through project or file names), temp folders, cancellation.
7. **Cross-cutting:** logging (what is logged, secrets), settings versus `docs/settings.md`, `package.json` contributions versus code, activation and disposal (every watcher and listener disposed), bundle size, dependencies (unused, outdated, licences), the build and release scripts, CI.
8. **Tests:** quality over count: tests that cannot fail, mocks that hide real behaviour, tests that depend on the machine (dotnet, network, time), missing tests for risky code (list the files with the most logic and the least coverage).
9. **Docs:** every page against the current behaviour, every setting and command documented, README as store page, `manual-testing.md` entries that are stale.

## Method (per area)

- A reviewer reads the area completely, runs it where possible (tests, scratch projects with real `dotnet`), and reports findings as: file:line, what is wrong, a concrete failing scenario, severity (bug / risk / cleanup).
- A second reviewer tries to disprove each bug and risk (the project-items review showed that running real MSBuild finds what reading does not).
- Findings are triaged by the user into: fix now (a task each, test first), roadmap "Known bugs", or won't fix. Nothing is changed during the review itself.
- Output: `docs/superpowers/reviews/<date>-<area>.md` per area, a summary at the top of the roadmap's Known bugs.

## Checklists the reviewers must apply

- Security: command construction from user input (project/file names, URLs, feed names), secrets in logs, settings or temp files, webview content security policy and message validation (the host must never trust the webview), path traversal in file operations.
- Windows and macOS: path separators and case, line endings, `.cmd` shims, process APIs, drive letters (Windows is a CI gate).
- Robustness: every `await` on external processes has a timeout and an error path; no unhandled rejections; no silent catch without a log line.
- Disposal: every `createFileSystemWatcher`, event emitter subscription, timer and child process is disposed on deactivate or when its owner goes away.
- Performance: work at activation (processes started per project), tree rebuild frequency, big solutions (100+ projects) and big folders.
- Dead code: unused exports, unreachable branches, commented-out code, messages in `types/commands` nobody sends.

## Done when

All areas reviewed, every finding triaged, the "fix now" ones fixed and verified, the rest in the roadmap, `npm test`, `npm run build:dev` and the CI (Windows included) green.
