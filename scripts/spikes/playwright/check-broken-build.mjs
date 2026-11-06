// manual-testing.md, "Test Explorer: a test project that does not build marks its tests errored with the first error lines in the message".
// Not covered: the message itself (only in the result's peek, not in the tree rows) and Cancel during a long build stopping `dotnet build`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorkspace, launch, openSolutionExplorer, check } from './lib.mjs';

const ws = prepareWorkspace({});
const { app, win } = await launch(ws);
try {
    await openSolutionExplorer(win);
    await win.locator('.activitybar [role=tab]:has(a[aria-label="Testing"])').click();
    const rows = win.locator('.pane-body .monaco-list-row');
    for (let i = 0; i < 40 && await rows.count() < 3; i++) await win.waitForTimeout(500);
    // First a good build and discovery, then the syntax error
    await win.getByRole('button', { name: /Refresh Tests/i }).first().click();
    const notBuilt = async () => (await rows.allInnerTexts()).filter(t => t.includes('not built yet')).length;
    for (let i = 0; i < 90 && await notBuilt() > 0; i++) await win.waitForTimeout(1000);
    writeFileSync(join(ws.folder, 'tests/Shop.Core.Tests/Broken.cs'), 'namespace Shop.Core.Tests;\n\npublic class Broken { void M( { } }\n');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Control+Shift+p');
    await win.keyboard.type('Test: Run All Tests');
    await win.waitForTimeout(1000);
    await win.keyboard.press('Enter');
    const stateOf = () => rows.filter({ hasText: /^Shop\.Core\.Tests/ }).first().evaluate(e => ({ state: [...e.querySelectorAll('.codicon')].map(c => c.className).join(' ').match(/testing-(passed|failed|error|queued|running|unset)-icon/)?.[1], text: e.innerText.replace(/\s+/g, ' ') }));
    let now = await stateOf();
    for (let i = 0; i < 90 && !['error', 'failed'].includes(now.state); i++) { await win.waitForTimeout(1000); now = await stateOf(); }
    check('the project that does not build is errored', ['error', 'failed'].includes(now.state), JSON.stringify(now));
} finally { await app.close(); }
