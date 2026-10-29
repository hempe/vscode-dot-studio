import { DotnetProcess, sortProcesses } from './dotnetProcesses';
import { PortsByPid } from './listeningPorts';

export interface AttachItem {
    pid: number;
    /** `Shop.Web (pid 1234) :5181` */
    label: string;
    /** The solution project, empty for other programs */
    description: string;
    /** The command line */
    detail: string;
}

const MAX_DETAIL = 200;

/** The entries of the picker: the label has the pid and the ports, so typing either finds the process */
export function buildAttachItems(processes: DotnetProcess[], ports: PortsByPid): AttachItem[] {
    return sortProcesses(processes).map(process => {
        const listening = (ports.get(process.pid) ?? []).map(port => ` :${port}`).join('');
        const commandLine = process.commandLine.length > MAX_DETAIL ? `${process.commandLine.slice(0, MAX_DETAIL)}...` : process.commandLine;
        return {
            pid: process.pid,
            label: `${process.name} (pid ${process.pid})${listening}`,
            description: process.project ?? '',
            detail: commandLine,
        };
    });
}
