# Keyboard Shortcuts

Keys for Windows and Linux; on macOS use Cmd instead of Ctrl where VS Code does (Delete in the tree is Cmd+Backspace). Change any of them in VS Code's Keyboard Shortcuts editor (Ctrl+K Ctrl+S).

## This extension

| Key | Command | Where |
|---|---|---|
| Ctrl+F5 | Start Without Debugging: runs the startup project without the debugger | Anywhere, while not debugging |
| Ctrl+[, S | Sync with Active Document: selects the active editor's file in the Solution Explorer (macOS: Cmd+[, S) | Not in a text editor or the terminal (Ctrl+[ is VS Code's Outdent Line there; use the ⇄ button or the command palette) |
| Ctrl+K, Ctrl+E | Code Cleanup of the open C# file (macOS: Cmd+K, Cmd+E) | C# editor |
| Ctrl+Alt+L | Focus Solution Explorer. Some Linux desktops (XFCE, KDE) lock the screen with it; rebind one or the other | Anywhere |
| Ctrl+C | Copy the file or folder (macOS: Cmd+C) | Solution Explorer |
| Ctrl+X | Cut the file or folder (Paste moves it) (macOS: Cmd+X) | Solution Explorer |
| Ctrl+V | Paste into the project or folder (macOS: Cmd+V) | Solution Explorer |
| F2 | Rename | Solution Explorer |
| Delete | Delete a file or folder; remove a solution folder, solution item or reference (macOS: Cmd+Backspace) | Solution Explorer |

Keys in the Solution Explorer act on the node that has focus. Which commands each node offers: [Context menus](context-menus.md).

### Moving around the tree

| Key | |
|---|---|
| Up / Down | Previous / next node |
| Right | Expand |
| Left | Collapse, or go to the parent |
| Enter | Open a file; expand or collapse anything else |
| Space | Select the focused node |
| Ctrl+click / Shift+click | Add a node to the selection / select a range (macOS: Cmd+click) |
| Home / End | First / last node |
| Page Up / Page Down | 10 nodes up / down |
| Letters | Jump to the next node whose name starts with what you type (within a second: `pr` finds `Program.cs`); the same letter again goes to the next match |

### Error List

Double-click a row or press Enter on it to open the file at the line.

## Visual Studio's keys in VS Code

What a Visual Studio user reaches for, and what it is in VS Code (with the C# extension). Most of debugging and navigation is the same.

| Visual Studio | VS Code | |
|---|---|---|
| F5 | F5 | Start debugging (the `Startup` configuration by default); continue |
| Ctrl+F5 | Ctrl+F5 | Start without debugging (this extension) |
| Shift+F5 | Shift+F5 | Stop debugging |
| Ctrl+Shift+F5 | Ctrl+Shift+F5 | Restart debugging |
| F9 | F9 | Toggle breakpoint |
| F10 / F11 / Shift+F11 | F10 / F11 / Shift+F11 | Step over / into / out |
| Ctrl+Shift+B | Ctrl+Shift+B | Build the solution (this extension's default build task) |
| F12 | F12 | Go to definition |
| Ctrl+F12 | Ctrl+F12 | Go to implementation |
| Shift+F12 | **Shift+Alt+F12** | Find all references (Shift+F12 peeks at them) |
| Ctrl+. | Ctrl+. | Quick actions and refactorings |
| Ctrl+R, Ctrl+R | **F2** (in the editor) | Rename symbol |
| Ctrl+K, Ctrl+C / Ctrl+K, Ctrl+U | Ctrl+K Ctrl+C / Ctrl+K Ctrl+U | Comment / uncomment lines (also Ctrl+/) |
| Ctrl+K, Ctrl+D | **Ctrl+Shift+I** (Windows: Shift+Alt+F) | Format document |
| Ctrl+T / Ctrl+, | **Ctrl+P** (files), **Ctrl+T** (symbols) | Go to all |
| Ctrl+R, T / Ctrl+R, Ctrl+T | **Ctrl+; C** / **Ctrl+; Ctrl+C** | Run / debug the test at the cursor |
| Ctrl+R, A | **Ctrl+; A** | Run all tests |
| Ctrl+K, Ctrl+E | Ctrl+K, Ctrl+E | Code Cleanup (this extension: format, unused usings, `.editorconfig` fixes; no sorting of usings) |
| Ctrl+[, S | Ctrl+[, S | Sync with Active Document (this extension) |
| Ctrl+Alt+L | Ctrl+Alt+L | Focus the Solution Explorer (this extension) |
| Ctrl+\\, E | **.NET: Show Error List** (no key; VS Code's Ctrl+\\ splits the editor) | Show the Error List, a tab in the panel |

## Changing keys

Open VS Code's **Keyboard Shortcuts** (Ctrl+K Ctrl+S) and search for `shinobi` or `.NET`: every command of this extension is there, including the Solution Explorer's menu commands, which the command palette hides. Change a key, remove it, or give a key to a command that has none, e.g. **.NET: Show Error List**. Your changes are kept in your `keybindings.json` and survive updates.

The Solution Explorer keys have a condition (`shinobi.solutionExplorer.focusedNodeType =~ ...`) so they only act on the tree; keep it when you change their key, or Ctrl+C would copy tree nodes everywhere.

