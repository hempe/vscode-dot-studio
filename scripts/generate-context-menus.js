// Regenerates the Solution Explorer context menu commands, menus and keybindings in package.json, and the
// menu reference docs/context-menus.md, from src/core/contextMenus.ts. Run via `npm run generate:menus`.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/core/contextMenus.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const mod = { exports: {} };
new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require);

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
fs.writeFileSync(pkgPath, JSON.stringify(mod.exports.applyMenuContributions(pkg), null, 2) + '\n');
fs.writeFileSync(path.join(root, 'docs', 'context-menus.md'), mod.exports.buildMenuReference());
console.log('package.json context menus and docs/context-menus.md updated');
