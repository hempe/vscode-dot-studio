// Prints the CHANGELOG.md section of a version, for the notes of a GitHub release:
//   node scripts/release-notes.js 0.1.0 [CHANGELOG.md]
// Fails when the version has no (or an empty) section, so a release cannot go out without a changelog entry.
const fs = require('fs');

/** The text under the `## <version>` heading (`## 0.1.0`, `## 0.1.0 - 2026-10-20`, `## [0.1.0]`) up to the next `## ` heading */
function releaseNotes(changelog, version) {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^## \\[?v?${escaped}\\]?(?:\\s.*)?$`, 'm').exec(changelog);
    if (!heading) {
        throw new Error(`CHANGELOG.md has no "## ${version}" section`);
    }
    const rest = changelog.slice(heading.index + heading[0].length);
    const next = rest.search(/^## /m);
    const notes = (next < 0 ? rest : rest.slice(0, next)).trim();
    if (!notes) {
        throw new Error(`The "## ${version}" section of CHANGELOG.md is empty`);
    }
    return notes;
}

module.exports = { releaseNotes };

if (require.main === module) {
    const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
    if (!version) {
        console.error('Usage: node scripts/release-notes.js <version> [CHANGELOG.md]');
        process.exit(2);
    }
    try {
        process.stdout.write(releaseNotes(fs.readFileSync(file, 'utf8'), version) + '\n');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
