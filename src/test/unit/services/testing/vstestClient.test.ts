import { connectVsTest, encode, VsTestReader, vstestCaseNode, vstestResultNode, VsTestCase } from '../../../../services/testing/vstestClient';
import { recording, replay } from './vstestReplay';
import { buildTestTree, outcomeOf } from '../../../../services/testing/testTree';
import { DEFAULT_RUN_SETTINGS } from '../../../../services/testing/runSettings';

describe('vstestClient', () => {
    it('frames messages like .NET\'s BinaryWriter strings (7-bit encoded length)', () => {
        const long = { text: 'x'.repeat(200) };
        const framed = encode(long);
        expect(framed[0]).toBe(0x80 | (framed.length - 2) & 0x7f);
        expect(new VsTestReader().push(Buffer.concat([encode({ a: 1 }), framed.subarray(0, 50)]))).toEqual([{ a: 1 }]);
        const reader = new VsTestReader();
        reader.push(framed.subarray(0, 50));
        expect(reader.push(framed.subarray(50))).toEqual([long]);
    });

    it('discovers the tests of a VSTest project (xUnit v2) and they fit the Test Explorer tree', async () => {
        const sent: any[] = [];
        const session = await connectVsTest(replay('XUnit2Tests-discover', sent));
        const cases = await session.discover(['/repo/tests/Shop.Core.XUnit2Tests/bin/Debug/net10.0/Shop.Core.XUnit2Tests.dll']);
        await session.close();

        expect(sent.map(m => m.MessageType)).toEqual(['ProtocolVersion', 'Extensions.Initialize', 'TestDiscovery.Start', 'TestSession.Terminate']);
        expect(cases).toHaveLength(4);

        const [ns] = buildTestTree(cases.map(vstestCaseNode));
        const outline = (entry: any, indent = ''): string[] => [`${indent}${entry.label}${entry.line ? ` :${entry.line}` : ''}`, ...entry.children.flatMap((child: any) => outline(child, indent + '  '))];
        expect(outline(ns)).toEqual([
            'Shop.Core.XUnit2Tests.Pricing',
            '  BulkDiscountTests :10',
            '    NoDiscountBelowTen :10',
            '    FailsOnPurpose :16',
            '    TenPercentFromTen :24',
            '      quantity: 10, expected: 10 :24',
            '      quantity: 20, expected: 20 :24',
        ]);
    });

    it('groups NUnit tests by their fully qualified names (NUnit reports no type and method)', async () => {
        const session = await connectVsTest(replay('NUnitTests-discover'));
        const cases = await session.discover(['/repo/tests/Shop.Core.NUnitTests/bin/Debug/net10.0/Shop.Core.NUnitTests.dll']);
        await session.close();

        const [ns] = buildTestTree(cases.map(vstestCaseNode));
        expect(ns.label).toBe('Shop.Core.NUnitTests.Orders');
        const [cls] = ns.children;
        expect(cls.label).toBe('OrderTests');
        expect(cls.children.map(method => [method.label, method.children.map(c => c.label)])).toEqual([
            ['CountsQuantities', ['1', '3']],
            ['FailsOnPurpose', []],
            ['SumsTheLines', []],
        ]);
    });

    it('runs tests and reports outcomes with messages, stack traces and durations', async () => {
        const session = await connectVsTest(replay('XUnit2Tests-run'));
        const results: any[] = [];
        await session.run({ sources: ['/repo/x.dll'] }, batch => results.push(...batch.map(vstestResultNode)));
        await session.close();

        const outcomes = Object.fromEntries(results.map(node => [node['display-name'].replace(/^.*\./, ''), outcomeOf(node)]));
        expect(outcomes['NoDiscountBelowTen']).toEqual({ state: 'passed', duration: expect.any(Number) });
        expect(outcomes['FailsOnPurpose']).toEqual(expect.objectContaining({
            state: 'failed',
            message: expect.stringContaining('Assert.Equal() Failure'),
            stackTrace: expect.stringContaining('BulkDiscountTests.cs:line 17'),
        }));
        expect(results).toHaveLength(4);
    });

    it('runs the selected test cases', async () => {
        const sent: any[] = [];
        const selected = recording('NUnitTests-discover').find(m => m.MessageType === 'TestDiscovery.TestFound').Payload.slice(2) as VsTestCase[];
        const session = await connectVsTest(replay('NUnitTests-run', sent));
        await session.run({ testCases: selected }, () => { });
        await session.close();

        const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
        expect(request.Payload.TestCases.map((test: VsTestCase) => test.DisplayName)).toEqual(['FailsOnPurpose', 'SumsTheLines']);
        expect(request.Payload.Sources).toBeUndefined();
    });

    it('debugs: VSTest starts the test host paused and waits until the debugger is attached', async () => {
        const sent: any[] = [];
        const attached: number[] = [];
        const session = await connectVsTest(replay('NUnitTests-debug', sent));
        const results: any[] = [];
        await session.run({ sources: ['/repo/x.dll'] }, batch => results.push(...batch), async processId => { attached.push(processId); return true; });
        await session.close();

        expect(sent.map(m => m.MessageType)).toContain('TestExecution.GetTestRunnerProcessStartInfoForRunAll');
        expect(sent.find(m => m.MessageType === 'TestExecution.GetTestRunnerProcessStartInfoForRunAll').Payload.DebuggingEnabled).toBe(true);
        expect(attached).toEqual([expect.any(Number)]);
        expect(sent.find(m => m.MessageType === 'TestExecution.EditorAttachDebuggerCallback').Payload).toEqual({ Attached: true });
        expect(results).toHaveLength(2);
    });

    it('sends the given run settings for discovery and runs, the default ones otherwise', async () => {
        const settings = '<RunSettings><RunConfiguration><DesignMode>true</DesignMode><MaxCpuCount>0</MaxCpuCount></RunConfiguration></RunSettings>';
        const sent: any[] = [];
        const session = await connectVsTest(replay('NUnitTests-discover', sent));
        await session.discover(['/repo/x.dll'], settings);
        await session.discover(['/repo/x.dll']);
        await session.close();
        expect(sent.filter(m => m.MessageType === 'TestDiscovery.Start').map(m => m.Payload.RunSettings)).toEqual([settings, DEFAULT_RUN_SETTINGS]);

        const ran: any[] = [];
        const running = await connectVsTest(replay('NUnitTests-run', ran));
        await running.run({ sources: ['/repo/a.dll', '/repo/b.dll'], runSettings: settings }, () => { });
        await running.close();
        const request = ran.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
        expect(request.Payload).toEqual({ Sources: ['/repo/a.dll', '/repo/b.dll'], RunSettings: settings });
    });

    it('does not wait for the timeout when vstest.console ends before it connected (review A5-9)', async () => {
        const started = Date.now();
        await expect(connectVsTest(async () => ({
            kill: () => { }, output: () => 'Could not find testhost',
            onExit: listener => { setTimeout(() => listener(1), 10); },
        }), 30000)).rejects.toThrow(/ended \(exit code 1\) before it connected[\s\S]*testhost/);
        expect(Date.now() - started).toBeLessThan(3000);
    });
});
