# Manual Testing in VS Code

Features that unit and integration tests cover, but that still need a run in VS Code itself (webviews, menus, the debugger). Start the extension with F5 from this repository; `.vscode/launch.json` (not committed) opens a test solution.

The reference solution used here, `ApiDotNetTestProject`, has an ASP.NET Core API with launch profiles (`Api`), a library (`Shared`), an xUnit v3 test project (`Shared.Tests`) and a console app with a WSDL for service references (`SoapClient`, `wsdl/CardOperations.wsdl`).

- [ ] Test Phase 7.5 (Visual Studio basics) in VS Code with ApiDotNetTestProject: Collapse All; Sync with Active Document from the title bar and with Ctrl+[, S (file in a collapsed folder, a nested file, a file outside the solution); Add Existing Item on a folder (also replacing a file); Debug > Start New Instance on `Api` while it is not the startup project, then Debug > Start Without Debugging; Ctrl+F5 and the title bar's Start Without Debugging; Run Tests and Debug Tests on `Shared.Tests`, a folder and a test file (the Test Explorer opens with the results); Open in Terminal, Copy Full Path, Edit Project File
- [ ] Test Phase 4 (service references) in VS Code with the `SoapClient` project in ApiDotNetTestProject: add from `wsdl/CardOperations.wsdl`, update, remove, and update a reference Visual Studio created
- [ ] Test Phase 5 (template wizards) in VS Code with ApiDotNetTestProject: Add New Project on the solution and on a solution folder (settings, framework, location), Add New Item on a folder (built-in class, API Controller with read/write actions, a config file), rename a file with nested files
- [x] Test Phase 6 (Test Explorer) in VS Code with `Shared.Tests` in ApiDotNetTestProject: tests appear after a build, run all and single tests, the failing test shows its message and jumps to its line, debug a test with a breakpoint
- [ ] Test Phase 2.5 (Error List table) in VS Code: sort, search, column filters, code links, double-click to the line; toggling warnings also removes their markers from the Solution Explorer
