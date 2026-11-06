// manual-testing.md, "a name wider than the view ends in an ellipsis and its tooltip shows the full name".
import { prepareWorkspace, launch, openSolutionExplorer, expandPath, check } from './lib.mjs';

const long = 'ThisIsAFileWithAVeryLongNameThatIsWiderThanTheSolutionExplorerViewForSure_AndEvenLongerThanThat.txt';
const ws = prepareWorkspace({}, { [`src/Shop.Web/${long}`]: 'x' });
const { app, win } = await launch(ws);
try {
    const tree = await openSolutionExplorer(win);
    await expandPath(win, tree, ['Contoso', 'src', 'Shop.Web']);
    await win.waitForTimeout(1000);
    const name = tree.locator('.tree-node .node-name', { hasText: long }).first();
    const info = await name.evaluate(e => ({ overflow: getComputedStyle(e).textOverflow, clipped: e.scrollWidth > e.clientWidth, title: e.title || e.closest('[title]')?.getAttribute('title') || '' }));
    check('the name is clipped with an ellipsis', info.overflow === 'ellipsis' && info.clipped, JSON.stringify(info));
    check('its tooltip shows the full name', info.title.includes(long), JSON.stringify(info));
} finally { await app.close(); }
