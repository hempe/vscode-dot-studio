import * as vscode from 'vscode';
import { SolutionProvider } from '../solutionProvider';
import { SolutionCommands } from './solutionCommands';
import { ProjectCommands } from './projectCommands';
import { FileCommands } from './fileCommands';
import { SolutionFolderCommands } from './solutionFolderCommands';

export class CommandManager {
    private solutionCommands: SolutionCommands;
    private projectCommands: ProjectCommands;
    private fileCommands: FileCommands;
    private solutionFolderCommands: SolutionFolderCommands;

    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider,
        private solutionTreeView: vscode.TreeView<any>
    ) {
        this.solutionCommands = new SolutionCommands(context, solutionProvider);
        this.projectCommands = new ProjectCommands(context, solutionProvider);
        this.fileCommands = new FileCommands(context, solutionProvider, solutionTreeView);
        this.solutionFolderCommands = new SolutionFolderCommands(context, solutionProvider, solutionTreeView);
    }

    public registerAllCommands(): void {
        console.log('Registering all extension commands...');
        
        this.solutionCommands.registerCommands();
        this.projectCommands.registerCommands();
        this.fileCommands.registerCommands();
        this.solutionFolderCommands.registerCommands();
        
        console.log('All extension commands registered successfully');
    }
}