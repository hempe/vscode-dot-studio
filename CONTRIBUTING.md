# Contributing

Thanks for helping. Bug reports, translations and pull requests are all welcome.

## Where to start

- **Issues** labelled [`good first issue`](https://github.com/hempe/vscode-dot-studio/labels/good%20first%20issue) are small and self-contained; [`help wanted`](https://github.com/hempe/vscode-dot-studio/labels/help%20wanted) ones are bigger. Comment on an issue before you start on it, so two people don't do the same work.
- **A bug** you hit: open an issue with the solution layout (`.sln` or `.slnx`, SDK-style projects or not), the editor (VS Code, VSCodium, Cursor...) and its C# extension, and what you expected. The log is in the Output panel, channel *Shinobi .NET Studio*.
- **A feature:** open an issue first. The extension follows Visual Studio, so "Visual Studio does X" is a strong argument; ideas Visual Studio doesn't have are welcome too, but may wait.

## Build, run, test

[DEVELOPER.md](DEVELOPER.md) has the details. In short, with Node.js 20+, the .NET SDK 8+ and a C# extension:

```bash
npm install
npm run build:dev
npm test
```

F5 with the launch configuration from DEVELOPER.md opens a second window with the extension on the sample solution.

How the code is laid out (the extension host, the React webviews and the messages between them, the solution model) is in DEVELOPER.md's *Project structure* and, in more depth, [CLAUDE.md](CLAUDE.md).

## Pull requests

- One change per pull request; CI (typecheck, tests and build on Linux, Windows and macOS) has to pass.
- A change users can notice updates its page in [`docs/`](docs/README.md) in the same pull request.
- Every new or changed text users see needs its Chinese translation too (a test fails otherwise); if you don't speak Chinese, say so in the pull request and we'll add it.
- What can't be tested automatically goes into [docs/manual-testing.md](docs/manual-testing.md) as an unticked entry.
- TypeScript is strict: unused variables and parameters break the build. `npm run lint` catches promises nobody waits for.

## Translations

The extension speaks English and Simplified Chinese; a new language is a welcome contribution. Texts live in three places:

- `package.nls.<lang>.json`: commands, settings and views (copy `package.nls.json`, translate the values)
- `l10n/bundle.l10n.<lang>.json`: messages, questions and quick picks (copy `l10n/bundle.l10n.json`)
- `src/webview/shared/i18n.ts`: the webviews (Solution Explorer, NuGet manager, wizards); it knows only Chinese so far, so a new language extends it with a second dictionary

VS Code picks the first two up by itself. Words that are code (`override`, type and file names) stay as they are. Open an issue first and we'll help with the webview part and the coverage test (`src/test/unit/core/i18nCoverage.test.ts`).
