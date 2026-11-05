// manual-testing.md, "Test Explorer with VSTest projects": Shop.Core.Tests (Microsoft.Testing.Platform, xUnit v3), Shop.Core.XUnit2Tests (xUnit v2) and
// Shop.Core.NUnitTests (NUnit) are discovered, Run All Tests gives the right states (passed, failed with its message, error), parameterized cases
// are listed, and a click on a failed test opens its file at the line. Not covered: debugging a test, Run Tests from the Solution Explorer's menu.
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

const ws = prepareWorkspace({});
const { app, win } = await launch(ws);
try {
    await openSolutionExplorer(win);
    await win.locator('.activitybar [role=tab]:has(a[aria-label="Testing"])').click();
    const notBuilt = async () => (await win.locator('.pane-body .monaco-list-row').allInnerTexts()).filter(t => t.includes('not built yet')).length;
    for (let i = 0; i < 40 && await notBuilt() < 3; i++) await win.waitForTimeout(500);
    await win.getByRole('button', { name: /Refresh Tests/i }).first().click();
    for (let i = 0; i < 90 && (await notBuilt() > 0 || (await win.locator('.pane-body .monaco-list-row').count()) < 3); i++) await win.waitForTimeout(1000);
    check('the three test projects are discovered (built by the refresh)', await notBuilt() === 0);

    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('Test: Run All Tests');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Enter');
    // Wait for the results: no row is running or queued any more
    const rows = win.locator('.pane-body .monaco-list-row');
    await rows.first().click();
    const read = () => rows.evaluateAll(l => l.map(e => ({ text: e.innerText.replace(/\s+/g, ' '), state: [...e.querySelectorAll('.codicon')].map(c => c.className).join(' ').match(/testing-(passed|failed|error|queued|running)-icon/)?.[1] ?? '' })));
    for (let i = 0; i < 120; i++) {
        const now = await read();
        if (now.some(r => r.state === 'failed') && !now.some(r => r.state === 'queued' || r.state === 'running')) break;
        await win.waitForTimeout(1000);
    }
    for (let i = 0; i < 60; i++) { await win.keyboard.press('ArrowRight'); await win.keyboard.press('ArrowDown'); }
    await win.waitForTimeout(1000);
    const all = await read();
    const states = name => all.filter(r => r.text.startsWith(name)).map(r => r.state);
    check('SumsTheLines passed (NUnit)', states('SumsTheLines').includes('passed'), JSON.stringify(states('SumsTheLines')));
    check('NoDiscountBelowTen passed (xUnit v2)', states('NoDiscountBelowTen').includes('passed'));
    check('RejectsZeroQuantity passed (xUnit v3)', states('RejectsZeroQuantity').includes('passed'));
    const failing = states('FailsOnPurpose');
    check('FailsOnPurpose failed in all three projects', failing.length >= 3 && failing.every(s => s === 'failed'), JSON.stringify(failing));
    check('a failed test carries its message', all.some(r => r.text.startsWith('FailsOnPurpose') && /Assert|Expected|Failure/i.test(r.text)));
    check('MultipliesByQuantity errored (the sample throws)', states('MultipliesByQuantity').includes('error'), JSON.stringify(states('MultipliesByQuantity')));
    check('parameterized cases are listed and passed (xUnit v2)', all.some(r => r.text.startsWith('quantity: 10, expected: 10') && r.state === 'passed'));
    check('parameterized cases are listed and passed (NUnit)', all.some(r => /CountsQuantities/.test(r.text) && r.state === 'passed'));

    // A click on a failed test opens its file at the line
    const failed = rows.filter({ hasText: /^FailsOnPurpose/ }).first();
    await failed.dblclick();
    await win.waitForTimeout(2500);
    check('a double-click on a failed test opens its file', await win.locator('.tab[aria-label*="OrderTests.cs"], .tab[aria-label*="BulkDiscountTests.cs"]').count() > 0);
    const status = await win.locator('.statusbar').innerText().then(t => t.replace(/\s+/g, ' '));
    const line = Number(status.match(/Ln (\d+)/)?.[1] ?? 0);
    check('at the test\'s line', line >= 14 && line <= 25, status.slice(0, 160));
} finally { await app.close(); }
