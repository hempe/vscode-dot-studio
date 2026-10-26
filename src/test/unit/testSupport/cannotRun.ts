/**
 * A real-dotnet test whose setup is not there (no `dotnet`, packages that cannot be restored). On CI that is a failure: a
 * test that returns early is reported as passed and hides a broken setup. On a developer machine (offline, no SDK) it
 * only warns, so the rest of the suite stays usable.
 */
export function cannotRun(reason: string): void {
    if (process.env.CI) {
        throw new Error(`Cannot run on CI: ${reason}`);
    }
    console.warn(`${reason}, skipping`);
}
