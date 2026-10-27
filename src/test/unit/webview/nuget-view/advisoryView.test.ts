import { advisoryBadges, passesAdvisoryFilter, worstSeverity } from '../../../../webview/nuget-view/advisoryView';

const high = { vulnerabilities: [{ severity: 'Low', url: 'a' }, { severity: 'High', url: 'b' }] };
const deprecated = { deprecation: { reasons: ['Legacy', 'CriticalBugs'], alternative: { id: 'Azure.Storage.Common' } } };

describe('advisory view helpers', () => {
    it('names the worst severity', () => {
        expect(worstSeverity(high)).toBe('High');
        expect(worstSeverity({ vulnerabilities: [{ severity: 'critical', url: 'a' }, { severity: 'High', url: 'b' }] })).toBe('Critical');
        expect(worstSeverity({ vulnerabilities: [{ severity: 'Weird', url: 'a' }] })).toBe('Weird');
        expect(worstSeverity(undefined)).toBeUndefined();
    });

    it('makes a badge for each kind, with the count and the replacement in the tooltip', () => {
        expect(advisoryBadges({ ...high, ...deprecated })).toEqual([
            { kind: 'vulnerable', text: 'vulnerable: high', title: '2 known vulnerabilities in this version' },
            { kind: 'deprecated', text: 'deprecated', title: 'Deprecated (Legacy, CriticalBugs); use Azure.Storage.Common instead' },
        ]);
        expect(advisoryBadges({ vulnerabilities: [{ severity: 'Low', url: 'a' }] })[0].title).toBe('1 known vulnerability in this version');
        expect(advisoryBadges(undefined)).toEqual([]);
    });

    it('filters: off shows all, on shows the flagged ones, both on shows either', () => {
        expect(passesAdvisoryFilter(undefined, { vulnerable: false, deprecated: false })).toBe(true);
        expect(passesAdvisoryFilter(undefined, { vulnerable: true, deprecated: false })).toBe(false);
        expect(passesAdvisoryFilter(high, { vulnerable: true, deprecated: false })).toBe(true);
        expect(passesAdvisoryFilter(high, { vulnerable: false, deprecated: true })).toBe(false);
        expect(passesAdvisoryFilter(deprecated, { vulnerable: true, deprecated: true })).toBe(true);
    });
});
