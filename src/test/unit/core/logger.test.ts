import { inspect } from 'util';
import { logger, setLogSink } from '../../../core/logger';

describe('logger', () => {
    afterEach(() => setLogSink(undefined));

    it('writes to the log channel once the extension provides one, with the area and the details', () => {
        const lines: [string, string][] = [];
        const record = (level: string) => (message: string) => { lines.push([level, message]); };
        setLogSink({ trace: record('trace'), debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') });
        const log = logger('NuGet');

        log.info('Loaded feeds', ['nuget.org', 'contoso']);
        log.debug('Details', { count: 2 });
        log.warn('Slow');
        log.error('Install failed:', new Error('401 Unauthorized'));

        expect(lines[0]).toEqual(['info', "[NuGet] Loaded feeds [ 'nuget.org', 'contoso' ]"]);
        expect(lines[1]).toEqual(['debug', '[NuGet] Details { count: 2 }']);
        expect(lines[2]).toEqual(['warn', '[NuGet] Slow']);
        expect(lines[3][0]).toBe('error');
        expect(lines[3][1]).toMatch(/^\[NuGet\] Install failed: Error: 401 Unauthorized\n\s+at /);
    });

    it('does not build the message of a level the channel drops (no dump of the objects in a debug line)', () => {
        const sent: string[] = [];
        const log = logger('Tree');
        let inspected = 0;
        const big = { [inspect.custom]() { inspected++; return 'dump'; } };
        setLogSink({
            enabled: level => level !== 'debug' && level !== 'trace',
            trace: m => { sent.push(m); }, debug: m => { sent.push(m); }, info: m => { sent.push(m); }, warn: m => { sent.push(m); }, error: m => { sent.push(m); },
        });

        log.debug('Got data', big);
        log.shotgun('deep', big);
        expect(inspected).toBe(0);
        expect(sent).toEqual([]);

        log.info('Got data', big);
        expect(inspected).toBe(1);
        expect(sent).toHaveLength(1);
    });

    it('logs to the console without a channel (tests, scripts)', () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        logger('Build').warn('No solution');
        expect(spy).toHaveBeenCalledWith(expect.stringMatching(/\[WRN\] Build: No solution$/));
        spy.mockRestore();
    });
});
