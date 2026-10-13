import { TestNode } from './testingPlatformClient';

/** A Test Explorer entry below the project: namespace → class → method → case */
export interface TreeEntry {
    /** The node uid for tests; `namespace:`, `class:`, `method:` plus the full name for groups */
    readonly id: string;
    readonly label: string;
    readonly kind: 'namespace' | 'class' | 'method' | 'case';
    readonly file?: string;
    readonly line?: number;
    readonly children: TreeEntry[];
    /** The test itself, for methods with a single node and for cases */
    readonly node?: TestNode;
}

/** `Positive(System.Int32)` → `Positive` */
export function methodName(locationMethod: string): string {
    return locationMethod.replace(/\(.*$/, '');
}

/** The part of the display name that tells cases apart: `X3.MathTests.Positive(x: 1)` → `x: 1`, `Positive (1)` → `1` */
function caseLabel(node: TestNode, method: string): string {
    const name = node['display-name'];
    const index = name.lastIndexOf(method);
    const rest = (index >= 0 ? name.slice(index + method.length) : name).trim();
    return rest.replace(/^\((.*)\)$/, '$1') || name;
}

interface MutableEntry extends TreeEntry {
    children: MutableEntry[];
    line?: number;
    file?: string;
}

/** The discovered tests of one project, grouped by namespace, class and method */
export function buildTestTree(nodes: TestNode[]): TreeEntry[] {
    const roots: MutableEntry[] = [];
    const groups = new Map<string, MutableEntry>();
    const group = (siblings: MutableEntry[], id: string, label: string, kind: TreeEntry['kind']): MutableEntry => {
        let entry = groups.get(id);
        if (!entry) {
            entry = { id, label, kind, children: [] };
            groups.set(id, entry);
            siblings.push(entry);
        }
        return entry;
    };
    const place = (entry: MutableEntry, node: TestNode) => {
        const line = node['location.line-start'];
        if (line !== undefined && (entry.line === undefined || line < entry.line)) {
            entry.line = line;
        }
        entry.file ??= node['location.file'];
    };

    const byMethod = new Map<string, TestNode[]>();
    for (const node of nodes.filter(n => !n['node-type'] || n['node-type'] === 'action')) {
        const type = node['location.type'] ?? '';
        const method = node['location.method'] ? methodName(node['location.method']) : node['display-name'];
        const key = `${type}.${method}`;
        byMethod.set(key, [...(byMethod.get(key) ?? []), node]);
    }

    for (const [key, methodNodes] of byMethod) {
        const first = methodNodes[0];
        const type = first['location.type'] ?? '';
        const lastDot = type.lastIndexOf('.');
        const namespace = lastDot > 0 ? type.slice(0, lastDot) : '';
        const className = type.slice(lastDot + 1) || '(no class)';
        const method = key.slice(type.length + 1);

        const parent = namespace ? group(roots, `namespace:${namespace}`, namespace, 'namespace').children : roots;
        const cls = group(parent, `class:${type}`, className, 'class');
        methodNodes.forEach(node => place(cls, node));

        if (methodNodes.length === 1) {
            const entry: MutableEntry = { id: first.uid, label: method, kind: 'method', children: [], node: first };
            place(entry, first);
            cls.children.push(entry);
        } else {
            const entry: MutableEntry = { id: `method:${key}`, label: method, kind: 'method', children: [] };
            for (const node of methodNodes) {
                const testCase: MutableEntry = { id: node.uid, label: caseLabel(node, method), kind: 'case', children: [], node };
                place(testCase, node);
                place(entry, node);
                entry.children.push(testCase);
            }
            cls.children.push(entry);
        }
    }
    return roots;
}

export type Outcome =
    | { readonly state: 'started' }
    | { readonly state: 'passed'; readonly duration?: number }
    | { readonly state: 'failed' | 'errored'; readonly duration?: number; readonly message: string; readonly expected?: string; readonly actual?: string; readonly stackTrace?: string }
    | { readonly state: 'skipped' };

/** What a result update means for the test; nothing for `discovered` */
export function outcomeOf(node: TestNode): Outcome | undefined {
    const duration = node['time.duration-ms'];
    const failure = (state: 'failed' | 'errored', fallback: string): Outcome => ({
        state,
        duration,
        message: node['error.message'] || fallback,
        // xUnit sends both empty; the values are in the message then
        ...(node['assert.expected'] || node['assert.actual'] ? { expected: node['assert.expected'] ?? '', actual: node['assert.actual'] ?? '' } : {}),
        ...(node['error.stacktrace'] ? { stackTrace: node['error.stacktrace'] } : {}),
    });
    switch (node['execution-state']) {
        case 'in-progress': return { state: 'started' };
        case 'passed': return { state: 'passed', duration };
        case 'skipped': return { state: 'skipped' };
        case 'failed': return failure('failed', 'Test failed');
        case 'timed-out': return failure('failed', 'Test timed out');
        case 'error': return failure('errored', 'Test errored');
        case 'cancelled': return failure('errored', 'Test cancelled');
        default: return undefined;
    }
}
