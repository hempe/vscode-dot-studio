// Webpack plugin: writes THIRD_PARTY_NOTICES.txt next to the bundle with the licence text of every npm package that ended up in it
// (MIT, ISC and BlueOak-1.0.0 require the notice to travel with copies, a minified bundle is a copy).
const fs = require('fs');
const path = require('path');

/** The folder of the npm package a file belongs to (`.../node_modules/@scope/name`), or undefined for our own files */
function packageRootOf(resource) {
    const marker = `${path.sep}node_modules${path.sep}`;
    const at = resource.lastIndexOf(marker);
    if (at < 0) {
        return undefined;
    }
    const rest = resource.slice(at + marker.length).split(path.sep);
    const segments = rest[0].startsWith('@') ? 2 : 1;
    return resource.slice(0, at + marker.length) + rest.slice(0, segments).join(path.sep);
}

function licenceText(root) {
    const file = fs.readdirSync(root).find(name => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name));
    return file ? fs.readFileSync(path.join(root, file), 'utf8').trim() : undefined;
}

class ThirdPartyNoticesPlugin {
    /** @param {{ extra?: string }} options text appended at the end (assets that are not npm bundles, e.g. the codicon font) */
    constructor(options = {}) {
        this.extra = options.extra ?? '';
    }

    apply(compiler) {
        compiler.hooks.thisCompilation.tap('ThirdPartyNoticesPlugin', compilation => {
            compilation.hooks.processAssets.tap({ name: 'ThirdPartyNoticesPlugin', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
                const roots = new Set();
                const visit = module => {
                    if (module.resource) {
                        const root = packageRootOf(module.resource);
                        if (root) {
                            roots.add(root);
                        }
                    }
                    (module.modules ?? []).forEach(visit);
                };
                compilation.modules.forEach(visit);

                const entries = [...roots].sort().map(root => {
                    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
                    const text = licenceText(root) ?? `Licence: ${pkg.license ?? 'see the package'}`;
                    return `${pkg.name} ${pkg.version}\n${pkg.license ? `License: ${typeof pkg.license === 'string' ? pkg.license : pkg.license.type}\n` : ''}\n${text}`;
                });
                const content = [
                    'Third-party software bundled with Shinobi .NET Studio',
                    '',
                    ...entries.flatMap(entry => [entry, '', '-'.repeat(72), '']),
                    ...(this.extra ? [this.extra, ''] : []),
                ].join('\n');
                compilation.emitAsset('THIRD_PARTY_NOTICES.txt', new compiler.webpack.sources.RawSource(content));
            });
        });
    }
}

module.exports = { ThirdPartyNoticesPlugin, packageRootOf };
