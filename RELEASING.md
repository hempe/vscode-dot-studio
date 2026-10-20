# Releasing

How to publish a new version of the extension, and the accounts you need once. Written for the maintainer who does this a few times a year and does not want to remember it. Users: see the [README](README.md).

A release is one click on GitHub; the rest is automatic (`.github/workflows/release.yml`). The version number lives only in the tag: `package.json` stays at `0.0.1` in git on purpose.

## Every release

1. Make sure what should go out is on `master` and the CI badge/run of that commit is green (Actions > CI; the Windows job is informational until it has been green once).
2. Add a section to [CHANGELOG.md](CHANGELOG.md) for the new version, newest first, as `## 0.2.0` (a date after it is fine) followed by what changed for users since the last release. The first release (`0.1.0`) is just "Initial release" with a short summary of the features, not a history. **The release fails without it** (the same text is the release notes if you leave them empty, and the stores show the changelog).
3. Commit and push that to `master`.
4. GitHub > Releases > **Draft a new release**: choose "Create new tag" and type `v0.2.0` (the tag is the version, `v` + `major.minor.patch`, nothing else), target `master`. Tick **Set as a pre-release** for a first or risky release. Leave the notes empty to use the changelog section, or write them. Click **Publish release**.
5. Watch Actions > Release. It runs typecheck and tests, builds one `.vsix` with the tag's version, publishes it to the Visual Studio Marketplace (VS Code) and Open VSX (VSCodium), and attaches it to the release. The run's summary says which stores got it.
6. Check the listings a few minutes later: marketplace.visualstudio.com/items?itemName=shinobi.dotnet and open-vsx.org/extension/shinobi/dotnet. Install the new version in VS Code once.

Version numbers: `major.minor.patch`. For the Marketplace's pre-release channel use an odd minor for pre-releases (`0.1.x`) and an even one for stable (`0.2.x`); a store never accepts the same version twice, so a failed publish after the version went out needs a new patch number.

## If the run fails

- *CHANGELOG.md has no "## x.y.z" section*: add it, then delete the release **and its tag** (Releases > the release > Delete, then `git push origin :refs/tags/v0.2.0`), and publish again.
- *The tagged commit is not on master*: tag a commit that is on master.
- *401 or 403 from a store*: the token expired or lost its scope. Azure DevOps tokens expire (at most one year): create a new one (scope **Marketplace > Manage**, all accessible organizations) and update the secret `VSCE_PAT`. For Open VSX create a token at open-vsx.org > Settings > Access Tokens, update `OVSX_PAT`, and check it with `npx ovsx verify-pat shinobi -p <token>`.
- *Version already exists*: the stores keep every version forever; use the next patch number.
- Try packaging by hand any time with `npx vsce package` (it runs the production build and lists what goes into the `.vsix`).

## One-time setup (do this before the first release)

Nothing here is needed for development, only for publishing. Never put a token into the repository: they live only as repository secrets (GitHub > the repository > Settings > Secrets and variables > Actions > New repository secret).

**Visual Studio Marketplace (VS Code)**

- [ ] A Microsoft account (a personal one works).
- [ ] An Azure DevOps organization at dev.azure.com (free, it only exists to issue the token).
- [ ] A Personal Access Token there: User settings > Personal access tokens > New Token; Organization **All accessible organizations**; Scopes **Custom defined**, show all scopes, **Marketplace > Manage**; the longest expiry (one year). Write the expiry date down: after it the release fails with 401 until a new token replaces the secret.
- [ ] The publisher at marketplace.visualstudio.com/manage: **Create publisher** with the ID `shinobi` (it must match `publisher` in `package.json` and cannot be changed later; the display name can).
- [ ] The token as the repository secret **`VSCE_PAT`**.

**Open VSX (VSCodium, and other editors that do not use Microsoft's store)**

- [ ] Sign in at open-vsx.org with GitHub.
- [ ] An Eclipse Foundation account at accounts.eclipse.org, with the same email, and your GitHub username filled in on its profile.
- [ ] Back on open-vsx.org: your profile > **Log in with Eclipse**, then sign the **Publisher Agreement** (publishing is refused until you did).
- [ ] An access token: open-vsx.org > Settings > **Access Tokens** > Generate New Token.
- [ ] The namespace, once: `npx ovsx create-namespace shinobi -p <token>` (it must match the publisher `shinobi`). Check the token with `npx ovsx verify-pat shinobi -p <token>`.
- [ ] The token as the repository secret **`OVSX_PAT`**.
- [ ] Optional: ask for the namespace to be verified (an issue at github.com/EclipseFdn/open-vsx.org, "Namespace ownership") so the listing does not say "unverified publisher".

**First release**

- [ ] Until a secret exists, the workflow skips that store and still makes the GitHub release. Publish `0.1.0` as a **pre-release** first (odd minor = pre-release channel), look at both listings, then publish `0.2.0` as the first stable release.
