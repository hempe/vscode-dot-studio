# Spike: a refactoring provider loaded into the C# extension's language server

`Shinobi.Refactorings.csproj` + `ExtractInterfaceAll.cs`: an 11 KB net10.0 library with one `CodeRefactoringProvider`. It compiles
against the language server's own assemblies (`RoslynDir`, the C# extension's `.roslyn` folder) and ships none of them.

`lsp.mjs` is a minimal LSP client: it starts `Microsoft.CodeAnalysis.LanguageServer --stdio [--extension <dll>]` on a solution,
waits for the projects, and prints the code actions at a few positions of `src/Shop.Core/Orders/Order.cs` (the Contoso sample in
`scripts/screenshots/sample`, restored with `dotnet restore Contoso.slnx`) and what resolving *Extract interface* edits.

    dotnet build -c Release scripts/spikes/roslyn-extension
    node scripts/spikes/roslyn-extension/lsp.mjs <copy of the sample> [scripts/spikes/roslyn-extension/bin/Release/net10.0/Shinobi.Refactorings.dll]

Result (2026-11-02): it works; the refactorings are built on it (`server-extension/`, see *Refactorings inside the C# server* in docs/history.md). Not part of the extension or its build.
