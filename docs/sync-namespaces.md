# Sync Namespaces

**Sync Namespaces** changes the namespaces of the C# files of a project or folder to match the project's root namespace and the folders they are in, like Visual Studio's Sync Namespaces. It applies the C# language server's own "Change namespace to ..." action, so the language server also updates the files that use the changed namespace.

## Where to find it

Right-click a **project** or a **folder** in the Solution Explorer > **Sync Namespaces**. On a project it covers all its C# files, on a folder only the files inside it (and its subfolders). Unloaded projects have no Sync Namespaces.

## What it does

1. **Confirmation:** a dialog says how many files it will look at ("Sync namespaces of 12 files in Shop.Web to match their folders? Other files that use them are updated too.") and asks **Sync**. Open files with unsaved changes are saved first.
2. **Progress:** a notification names the file it is on ("3 of 12: Models/Order.cs") and has a **Cancel** button. Cancelling stops after the current file; files already changed stay changed (use your source control to undo).
3. **Summary:** a message tells how many files changed ("Synced namespaces in 4 of 12 files"), with **Show Details** for the list in the **Sync Namespaces** output channel, including the files that failed and why. When every namespace already matches it says so.

Both file-scoped (`namespace A.B;`) and block-scoped (`namespace A.B { }`) namespaces work. The changed files are saved, and where other files referred to the old namespace (a `using`, or a fully qualified name), the language server fixes them too.

## Requirements

- **A C# extension** (`ms-dotnettools.csharp` or `muhammad-sammy.csharp`): the change comes from its language server. Without one, a message says so.
- **IDE0130 must be reporting.** The language server only offers "Change namespace" for a file whose namespace is reported as not matching its folder, which needs these lines in your `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.IDE0130.severity = warning
dotnet_style_namespace_match_folder = true
```

When files differ but the server offered nothing, the summary says so and shows both lines. Visual Studio honors the same lines, so the team shares one setting.

## How the namespace is chosen

The expected namespace is the project's `RootNamespace` (the project name when it has none) followed by the folder path below the project folder, as in Visual Studio's "Default namespace". A file that already has that namespace is left alone.

## Limits

- Files are handled one at a time, so a big project takes a while; run it on a folder to keep it short.
- Generated files (`.g.cs`, `.designer.cs`, `AssemblyInfo.cs`) and everything under `bin`, `obj` and hidden folders are skipped.
- Files without a namespace declaration are left alone.
- Files outside a project of the solution are not handled.
- It does not rename anything else: folders, files and types keep their names.
