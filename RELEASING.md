# Releasing

How to publish a new version of the extension, and the accounts you need once. Written for the maintainer who does this a few times a year and does not want to remember it. Users: see the [README](README.md).

A release is one click on GitHub; the rest is automatic (`.github/workflows/release.yml`), except the upload to the Visual Studio Marketplace, which is done by hand (see below). The version number lives only in the tag: `package.json` stays at `0.0.1` in git on purpose.

## Every release

1. Make sure what should go out is on `master` and the CI badge/run of that commit is green (Actions > CI; the Windows job is informational until it has been green once).
2. Add a section to [CHANGELOG.md](CHANGELOG.md) for the new version, newest first, as `## 0.2.0` (a date after it is fine) followed by what changed for users since the last release. The first release (`0.1.0`) is just "Initial release" with a short summary of the features, not a history. **The release fails without it** (the same text is the release notes if you leave them empty, and the stores show the changelog).
3. Commit and push that to `master`.
4. GitHub > Releases > **Draft a new release**: choose "Create new tag" and type `v0.2.0` (the tag is the version, `v` + `major.minor.patch`, nothing else), target `master`. Tick **Set as a pre-release** for a first or risky release. Leave the notes empty to use the changelog section, or write them. Click **Publish release**.
5. Watch Actions > Release. It runs typecheck and tests, builds one `.vsix` with the tag's version, publishes it to Open VSX (VSCodium) when `OVSX_PAT` is set, and attaches it to the release. The run's summary says which stores got it.
6. **Visual Studio Marketplace, by hand:** download `shinobi-dotnet.vsix` from the release, open marketplace.visualstudio.com/manage/publishers/shinobi, and upload it (**New extension** the first time, then the extension's **...** menu > **Update**). Whether it is a pre-release is part of the `.vsix` (the workflow built it with `--pre-release` for a pre-release). The Marketplace checks the file for a few minutes before it shows the version.
7. Check the listings a few minutes later: marketplace.visualstudio.com/items?itemName=shinobi.dotnet and open-vsx.org/extension/shinobi/dotnet. Install the new version in VS Code once.

Version numbers: `major.minor.patch`. For the Marketplace's pre-release channel use an odd minor for pre-releases (`0.1.x`) and an even one for stable (`0.2.x`); a store never accepts the same version twice, so a failed publish after the version went out needs a new patch number.

## If the run fails

- *CHANGELOG.md has no "## x.y.z" section*: add it, then delete the release **and its tag** (Releases > the release > Delete, then `git push origin :refs/tags/v0.2.0`), and publish again.
- *The tagged commit is not on master*: tag a commit that is on master.
- *401 or 403 from Open VSX*: the token is wrong or expired: create a token at open-vsx.org > Settings > Access Tokens, update `OVSX_PAT`, and check it with `npx ovsx verify-pat shinobi -p <token>`.
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

- [ ] Sign in at open-vsx.org with GitHub.
- [ ] An Eclipse Foundation account at accounts.eclipse.org, with the same email, and your GitHub username filled in on its profile.
- [ ] Back on open-vsx.org: your profile > **Log in with Eclipse**, then sign the **Publisher Agreement** (publishing is refused until you did).
- [ ] An access token: open-vsx.org > Settings > **Access Tokens** > Generate New Token.
- [ ] The namespace, once: `npx ovsx create-namespace shinobi -p <token>` (it must match the publisher `shinobi`). Check the token with `npx ovsx verify-pat shinobi -p <token>`.
- [ ] The token as the repository secret **`OVSX_PAT`**.
- [ ] Optional: ask for the namespace to be verified (an issue at github.com/EclipseFdn/open-vsx.org, "Namespace ownership") so the listing does not say "unverified publisher".

**First release**

- [ ] Until a secret exists, the workflow skips that store and still makes the GitHub release. Publish `0.1.0` as a **pre-release** first (odd minor = pre-release channel), upload the `.vsix` to the Marketplace by hand, look at both listings, then publish `0.2.0` as the first stable release.
