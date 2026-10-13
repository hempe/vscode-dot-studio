import * as fs from 'fs';
import * as path from 'path';
import { buildTestTree, methodName, outcomeOf, TreeEntry } from '../../../../services/testing/testTree';
import { TestNode } from '../../../../services/testing/testingPlatformClient';

const nodes = (name: string, state: string): TestNode[] => fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/testing-platform', name), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(m => m.method === 'testing/testUpdates/tests')
    .flatMap(m => (m.params.changes ?? []).map((c: any) => c.node))
    .filter((n: TestNode) => n['execution-state'] === state);

const outline = (entries: TreeEntry[], indent = ''): string[] =>
    entries.flatMap(e => [`${indent}${e.kind} ${e.label}${e.line ? ` :${e.line}` : ''}`, ...outline(e.children, indent + '  ')]);

describe('buildTestTree', () => {
    it('xUnit v3: namespace, class, methods and theory cases', () => {
        expect(outline(buildTestTree(nodes('X3.jsonl', 'discovered')))).toEqual([
            'namespace X3.Math',
            '  class MathTests :4',
            '    method Adds :4',
            '    method Fails :5',
            '    method Positive :6',
            '      case x: 1 :6',
            '      case x: 2 :6',
        ]);
    });

    it('MSTest runner: data rows as cases', () => {
        expect(outline(buildTestTree(nodes('MR.jsonl', 'discovered')))).toEqual([
            'namespace MR',
            '  class MathTests :5',
            '    method Adds :5',
            '    method Positive :6',
            '      case 1 :6',
            '      case 2 :6',
        ]);
    });

    it('single tests are identified by their uid, cases too, groups by name', () => {
        const discovered = nodes('X3.jsonl', 'discovered');
        const [ns] = buildTestTree(discovered);
        const [cls] = ns.children;
        const [adds, , positive] = cls.children;
        expect(ns.id).toBe('namespace:X3.Math');
        expect(cls.id).toBe('class:X3.Math.MathTests');
        expect(adds.id).toBe(discovered[0].uid);
        expect(adds.node).toBe(discovered[0]);
        expect(adds.file).toBe('/repo/X3/MathTests.cs');
        expect(positive.id).toBe('method:X3.Math.MathTests.Positive');
        expect(positive.children.map(c => c.id)).toEqual([discovered[2].uid, discovered[3].uid]);
    });

    it('tests without a namespace sit right under the class', () => {
        const tree = buildTestTree([{ uid: 'u', 'display-name': 'T.A', 'location.type': 'T', 'location.method': 'A' }]);
        expect(outline(tree)).toEqual(['class T', '  method A']);
    });
});

describe('outcomeOf', () => {
    const results = nodes('X3.jsonl', 'failed').concat(nodes('X3.jsonl', 'passed'));

    it('maps failures with their message; xUnit leaves expected/actual empty', () => {
        const failed = outcomeOf(results[0]);
        expect(failed).toMatchObject({ state: 'failed', message: 'Assert.Equal() Failure: Values differ\nExpected: 3\nActual:   2' });
        expect(failed).not.toHaveProperty('expected');
        expect(failed).toHaveProperty('stackTrace');
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'failed', 'assert.expected': '3', 'assert.actual': '2' }))
            .toMatchObject({ expected: '3', actual: '2' });
    });

    it('maps the other states', () => {
        expect(outcomeOf(results[1])).toMatchObject({ state: 'passed' });
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'in-progress' })).toEqual({ state: 'started' });
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'skipped' })).toEqual({ state: 'skipped' });
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'timed-out', 'error.message': 'slow' })).toMatchObject({ state: 'failed', message: 'slow' });
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'error' })).toMatchObject({ state: 'errored' });
        expect(outcomeOf({ uid: 'u', 'display-name': 'x', 'execution-state': 'discovered' })).toBeUndefined();
    });
});

describe('methodName', () => {
    it('drops the signature', () => {
        expect(methodName('Positive(System.Int32)')).toBe('Positive');
        expect(methodName('Adds')).toBe('Adds');
    });
});
