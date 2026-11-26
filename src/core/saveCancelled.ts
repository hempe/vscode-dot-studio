/** The user cancelled saving the temporary solution, so the change that needed it did not happen: no error to show */
export class SaveCancelledError extends Error {
    constructor() {
        super('The solution was not saved.');
    }
}

export const isSaveCancelled = (error: unknown): boolean => error instanceof SaveCancelledError;
