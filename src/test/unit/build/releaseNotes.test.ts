const { releaseNotes } = require('../../../../scripts/release-notes.js');

const changelog = `# Changelog

## Unreleased

- something new

## 0.2.0 - 2026-11-01

- **Added** B
- Fixed C

## [0.1.0]

First public version.

## 0.1.0-pre

older
`;

describe('releaseNotes', () => {
    it('returns the section of a version, up to the next heading', () => {
        expect(releaseNotes(changelog, '0.2.0')).toBe('- **Added** B\n- Fixed C');
    });

    it('accepts a bracketed heading and the last section', () => {
        expect(releaseNotes(changelog, '0.1.0')).toBe('First public version.');
        expect(releaseNotes(changelog, '0.1.0-pre')).toBe('older');
    });

    it('does not mix up versions that share a prefix', () => {
        expect(() => releaseNotes(changelog, '0.2')).toThrow('no "## 0.2" section');
        expect(() => releaseNotes(changelog, '0.1')).toThrow('no "## 0.1" section');
    });

    it('fails for a missing or an empty section', () => {
        expect(() => releaseNotes(changelog, '9.9.9')).toThrow('no "## 9.9.9" section');
        expect(() => releaseNotes('## 1.0.0\n\n## 0.9.0\ntext\n', '1.0.0')).toThrow('is empty');
    });
});
