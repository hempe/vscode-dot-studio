/** Listening TCP ports per process id, ascending */
export type PortsByPid = Map<number, number[]>;

function add(ports: PortsByPid, pid: number, port: number): void {
    if (!Number.isInteger(port) || port <= 0) {
        return;
    }
    const list = ports.get(pid) ?? [];
    if (!list.includes(port)) {
        list.push(port);
        list.sort((a, b) => a - b);
    }
    ports.set(pid, list);
}

/** The port of `0.0.0.0:5181`, `[::]:5181`, `*:5181` or `127.0.0.1:5181` */
function portOf(endpoint: string): number {
    return Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
}

/** Parses `ss -ltnpH`: `LISTEN 0 4096 127.0.0.1:5181 0.0.0.0:* users:(("Shop.Web",pid=1234,fd=9))` */
export function parseSs(output: string): PortsByPid {
    const ports: PortsByPid = new Map();
    for (const line of output.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 6 || columns[0] !== 'LISTEN') {
            continue;
        }
        const port = portOf(columns[3]);
        for (const match of line.matchAll(/pid=(\d+)/g)) {
            add(ports, Number(match[1]), port);
        }
    }
    return ports;
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -F pn` (macOS): `p1234` starts a process, `n*:5181` is one of its sockets */
export function parseLsof(output: string): PortsByPid {
    const ports: PortsByPid = new Map();
    let pid: number | undefined;
    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('p')) {
            pid = Number(line.slice(1));
        } else if (line.startsWith('n') && pid !== undefined && Number.isInteger(pid)) {
            // "n*:5181", "n[::1]:5181", also "n127.0.0.1:5181->..." never appears for LISTEN sockets
            add(ports, pid, portOf(line.slice(1)));
        }
    }
    return ports;
}

/**
 * Parses `netstat -ano -p TCP` (Windows): `  TCP    0.0.0.0:5181    0.0.0.0:0    LISTENING    1234`.
 * Listening rows are recognised by their foreign port 0, so a localized state name does not matter.
 */
export function parseNetstat(output: string): PortsByPid {
    const ports: PortsByPid = new Map();
    for (const line of output.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP' || portOf(columns[2]) !== 0) {
            continue;
        }
        add(ports, Number(columns[columns.length - 1]), portOf(columns[1]));
    }
    return ports;
}
