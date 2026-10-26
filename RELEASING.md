# Releasing

How to publish a new version of the extension, and the accounts you need once. Written for the maintainer who does this a few times a year and does not want to remember it. Users: see the [README](README.md).

A release is one click on GitHub; the rest is automatic (`.github/workflows/release.yml`), except the upload to the Visual Studio Marketplace, which is done by hand (see below). The version number lives only in the tag: `package.json` stays at `0.0.1` in git on purpose.

## Every release

1. Make sure what should go out is on `master` and the CI badge/run of that commit is green (Actions > CI; the Windows job is informational until it has been green once).
2. Add a section to [CHANGELOG.md](CHANGELOG.md) for the new version, newest first, as `## 0.2.0` (a date after it is fine) followed by what changed for users since the last release. The first release (`0.1.0`) is just "Initial release" with a short summary of the features, not a history. **The release fails without it** (the same text is the release notes if you leave them empty, and the stores show the changelog).
3. Commit and push that to `master`.
4. GitHub > Releases > **Draft a new release**: choose "Create new tag" and type `v0.2.0` (the tag is the version, `v` + `major.minor.patch`, nothing else), target `master`. Tick **Set as a pre-release** for a first or risky release. Leave the notes empty to use the changelog section, or write them. Click **Publish release**.
5. Watch Actions > Release. The `build` job (no secrets, read-only token) runs typecheck and tests and builds one `.vsix` with the tag's version; the `publish` job (the tokens, the OIDC identity, no project code) publishes it to Open VSX (VSCodium) when `OVSX_PAT` is set or trusted publishing is switched on (`OVSX_TRUSTED_PUBLISHING`), and attaches it to the release. The run's summary says which stores got it.
6. **Visual Studio Marketplace, by hand** (once the Release run is green and the release has its `.vsix`):
   1. Get the file: GitHub > Releases > the release > Assets > `shinobi-dotnet.vsix`, or `gh release download v0.2.0 --pattern '*.vsix' --dir /tmp` (use the tag you released).
   2. Open marketplace.visualstudio.com/manage/publishers/shinobi and sign in.
   3. Drag the `.vsix` onto the upload area ("Drag and Drop a file here or click to upload", seen on 2026-10-22), or click it and choose the file. Later releases: the extension's **...** menu > **Update**, if the page does not already offer the upload.
   4. Wait: the Marketplace validates the file and shows a verifying state for a few minutes. If it says the version already exists, the same version was uploaded before: release the next patch number.
   5. The listing's pre-release flag comes from the `.vsix` itself (the workflow built it with `--pre-release` for a pre-release), nothing to tick on the page.
7. Check the listings a few minutes later: marketplace.visualstudio.com/items?itemName=shinobi.dotnet-studio and open-vsx.org/extension/shinobi/dotnet-studio. Install the new version in VS Code once.

Version numbers: `major.minor.patch`. For the Marketplace's pre-release channel use an odd minor for pre-releases (`0.1.x`) and an even one for stable (`0.2.x`); a store never accepts the same version twice, so a failed publish after the version went out needs a new patch number.

## If the run fails

- *CHANGELOG.md has no "## x.y.z" section*: add it, then delete the release **and its tag** (Releases > the release > Delete, then `git push origin :refs/tags/v0.2.0`), and publish again.
- *The tagged commit is not on master*: tag a commit that is on master.
- *401 or 403 from Open VSX*: with trusted publishing, the registration does not match (user, repository, workflow filename `release.yml`, environment) or the namespace has lost its verified owner or its last active version; with a token, it is wrong or expired: create a new one and update `OVSX_PAT`.
- *Version already exists*: the stores keep every version forever; use the next patch number.
- Try packaging by hand any time with `npx vsce package` (it runs the production build and lists what goes into the `.vsix`).

## One-time setup (do this before the first release)

Nothing here is needed for development, only for publishing. Never put a token into the repository: they live only as repository secrets (GitHub > the repository > Settings > Secrets and variables > Actions > New repository secret).

**Visual Studio Marketplace (VS Code)**

- [x] A Microsoft account (a personal one works).
- [x] The publisher at marketplace.visualstudio.com/manage: **Create publisher** with the ID `shinobi` (it must match `publisher` in `package.json` and cannot be changed later; the display name can).
- [ ] Nothing else for the manual upload described under "Every release".

Why not automatic: `vsce publish` needs a Personal Access Token from an Azure DevOps organization, and creating an organization now requires linking an Azure subscription (Owner or Contributor role), and an Azure subscription is only available with a payment card, as far as known (found on 2026-10-22: `aex.dev.azure.com` > Create new organization > "Select an Azure subscription for billing", the Continue button stays disabled without one). Microsoft's publishing guide still says no subscription is needed; it is out of date on this. Global tokens retire on December 1, 2026 anyway, and Microsoft recommends Microsoft Entra authentication (`vsce publish --azure-credential`, workload identity federation) instead. If an Azure account or a company organization becomes available: create a token (**Marketplace > Manage**, all accessible organizations), store it as the repository secret **`VSCE_PAT`**, and the workflow publishes by itself again (the step is already in `release.yml`, it only runs when the secret exists); with Entra authentication the step has to change.

**Open VSX (VSCodium, and other editors that do not use Microsoft's store)**

No long-lived token is needed in the end: Open VSX supports *trusted publishing* from GitHub Actions (the workflow proves its identity with a short-lived OIDC token, wiki: github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing). It needs ownership of the namespace, a signed Publisher Agreement and an extension with at least one active version, so the very first version goes up by hand. Registering a trusted publisher currently needs a public GitHub repository (ours is).

- [x] An Eclipse Foundation account at accounts.eclipse.org with your GitHub username filled in on its profile (exactly as on GitHub).
- [ ] Sign in at open-vsx.org with GitHub, profile settings > **Log in with Eclipse**, sign the **Publisher Agreement** (publishing is refused until you did).
- [ ] A short-lived access token only to create the namespace: open-vsx.org/user-settings/tokens > generate; then, in your own terminal (not in a chat), `npx ovsx create-namespace shinobi -p <token>` (it must match `publisher` in `package.json`, same case). Delete the token afterwards.
- [ ] Claim the namespace so you are its verified owner (creating it does not do that): the ownership process in Open VSX's "Managing Namespaces" documentation (an issue at github.com/EclipseFdn/open-vsx.org).
- [ ] The first version by hand: after the first Release run, download `shinobi-dotnet.vsix` from the GitHub release and upload it with open-vsx.org's **Publish** link (as for the Marketplace).
- [ ] Register the trusted publisher: open-vsx.org/user-settings/trusted-publishers > GitHub Actions: user `hempe`, repository `vscode-dot-studio`, workflow filename `release.yml`, environment `release` (the publish job runs in the GitHub environment `release`, which GitHub creates on the first run; add a rule there that only tags may deploy, if you like). (A registration cannot be edited; delete and recreate it to change it.)
- [ ] Switch it on: `gh variable set OVSX_TRUSTED_PUBLISHING --body true`. The Release workflow then publishes to Open VSX by itself (step "Publish to Open VSX (trusted publishing)" of the `publish` job, the locked `ovsx` with `--trusted-publishing`; only that job has `id-token: write`). Do **not** also set an `OVSX_PAT` secret: a token always takes precedence over trusted publishing.
- [ ] Not tried yet: this step (the locked `ovsx` 1.3.0 has `--trusted-publishing`) has never run. Check the Release run's summary after the second release; if the step fails, upload by hand and fix the workflow.
- [ ] Fallback without trusted publishing: a token as the repository secret `OVSX_PAT` (`gh secret set OVSX_PAT`); the workflow then publishes with it. Check it with `npx ovsx verify-pat shinobi -p <token>`.

**First release**

- [ ] Until a secret exists, the workflow skips that store and still makes the GitHub release. Publish `0.1.0` as a **pre-release** first (odd minor = pre-release channel), upload the `.vsix` to the Marketplace by hand, look at both listings, then publish `0.2.0` as the first stable release.
