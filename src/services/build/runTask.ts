import * as vscode from 'vscode';
import { logger } from '../../core/logger';

const log = logger('RunTask');

/** Runs a task and resolves with its exit code once its process ends */
export async function runTask(task: vscode.Task): Promise<number | undefined> {
    let execution: vscode.TaskExecution | undefined;
    return new Promise<number | undefined>(resolve => {
        const listener = vscode.tasks.onDidEndTaskProcess(event => {
            if (event.execution === execution || event.execution.task === task) {
                listener.dispose();
                resolve(event.exitCode);
            }
        });
        vscode.tasks.executeTask(task).then(started => { execution = started; }, error => {
            listener.dispose();
            log.error(`Starting ${task.name} failed:`, error);
            resolve(undefined);
        });
    });
}
