# Publish

Right-click a project > **Publish...** opens the **Publish** tab, like Visual Studio's publish page.

## Profiles

Publish profiles are `Properties/PublishProfiles/<Name>.pubxml` files in Visual Studio's format: teammates in Visual Studio see the same profiles, and the ones they made show here.

- **Without profiles**, the tab starts with **Publish to a folder**: pick the folder (relative to the project or absolute) and **Finish** creates `FolderProfile.pubxml`.
- **New profile** adds another (`FolderProfile1`, ...). **Rename**, **Delete** and **Open .pubxml** work on the selected profile.
- Editing a profile changes only the settings you changed; everything else in the file stays.

## Publishing

Pick a profile and **Publish**. It runs `dotnet publish -p:PublishProfile=<Name>` as a task: the output is in the terminal, errors in the [Error List](error-list.md). When it is done, **Open folder** opens the publish folder.

The summary shows the target location, configuration, target framework, deployment mode, target runtime and file publish options, and when the profile was last published.

## Settings (Show all settings)

| Setting | |
|---|---|
| Configuration | Release by default |
| Target framework | One of the project's frameworks |
| Deployment mode | **Framework-dependent** (needs .NET on the machine it runs on) or **Self-contained** (brings .NET along; picks this machine's runtime if none is set) |
| Target runtime | **Portable**, or a runtime identifier (`linux-x64`, `win-x64`, `osx-arm64`, ...) |
| Target location | The publish folder |
| Delete all existing files prior to publish | Empties the folder first |
| Produce single file | One executable; needs a target runtime |
| Enable ReadyToRun compilation | Faster startup, bigger files; needs a target runtime |
| Trim unused code | Smaller output; needs self-contained |

## Other targets

Profiles for Azure App Service, container registries, FTP or IIS (made in Visual Studio) are listed with a note but not published yet; they are planned (Phase 31). Visual Studio keeps their passwords encrypted in `.pubxml.user`, which can't be read outside Windows.
