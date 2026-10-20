# Code Cleanup

**Code Cleanup** formats code, removes unused usings and applies the code style fixes of your `.editorconfig`, like Visual Studio's Analyze > Code Cleanup. It runs `dotnet format`, so teammates using it from the command line or in a pipeline get the same result.

## Where to find it

- Right-click a **solution**, **project**, **folder** or **file** in the Solution Explorer > **Code Cleanup**. On a folder or file it only touches what is inside, though the project is still restored (see Limits). On a file that is not C# it only says that Code Cleanup works on C# files.
- In the editor, with a C# file open: **Ctrl+K, Ctrl+E** (macOS: Cmd+K, Cmd+E), or **.NET: Code Cleanup** in the command palette. If the chord clashes with a key of yours, change it in the Keyboard Shortcuts editor.

Open files with unsaved changes are saved first, then `dotnet format` rewrites the files on disk and VS Code reloads the open ones.

## What it does

Three steps, shown in the progress notification:

1. **Formatting:** indentation, spacing, new lines and braces, as the `.editorconfig` asks (`dotnet format whitespace`).
2. **Removing unused usings:** the `using` lines nothing needs (IDE0005).
3. **Applying code style fixes:** the fixes the `.editorconfig` sets to the severity chosen below or higher: `var` or explicit types, braces, `this.` qualification, `readonly` fields, expression-bodied members, and the like (`dotnet format style`).

When it is done, a message tells how many files changed. Details are in the **Code Cleanup** output channel, which also opens from the error message when a step fails.

## What it does not do

- **It does not sort usings.** `dotnet format` has no step for it, and the C# server offers sorting as the **Sort Usings** quick action (Ctrl+. on the usings), not as VS Code's Organize Imports, so Code Cleanup leaves the order alone. Format Document (Ctrl+Shift+I) does not sort them either.
- It does not rewrite code to a style your `.editorconfig` does not ask for. Rules at a lower severity than the setting below stay as they are: no `var` or expression-bodied rewrites unless the `.editorconfig` raises those rules.
- It does not read Visual Studio's own Code Cleanup profiles (Profile 1 and 2). Put the rules in `.editorconfig` instead; Visual Studio honors them too.

## Unused usings and the SDK

- With the **.NET SDK 10** or newer, unused usings are removed without any configuration.
- With older SDKs (8, 9), `dotnet format` removes them only when the `.editorconfig` raises the rule to a warning:

```ini
[*.cs]
dotnet_diagnostic.IDE0005.severity = warning
```

Which SDK counts is the one `dotnet --version` reports in the folder of the project, so a `global.json` applies.

## Setting

`shinobi.codeCleanup.severity` decides which code style rules of the `.editorconfig` step 3 fixes, by the severity the rule has there:

| Value | Fixes rules set to |
|---|---|
| `info` | suggestion, warning and error |
| `warn` (default) | warning and error |
| `error` | error |

Formatting and unused usings do not depend on it. See [Settings](settings.md).

## Progress and Cancel

The progress notification names the step ("Formatting (1 of 3)") and has a **Cancel** button. Cancelling stops the running step; files changed by earlier steps stay changed (use your source control to undo).

## Limits

- Needs the `dotnet` SDK on the path. The style steps restore the project first, so a project that cannot restore (a private feed without credentials, for example) fails, and the message shows the first line of the error.
- `dotnet format` can take a while on a big solution; run Code Cleanup on a project or folder to keep it short.
- Files with syntax errors are not skipped: `dotnet format` does not stop on them.
- It works on C# files; other kinds are left alone.
