/**
 * The query of the untitled `.nuget` document that carries what the NuGet manager is opened for. Built and read with
 * URLSearchParams only: a path with `&`, `+`, `#` or `%` (`R&D`, `C++Interop`, `100%`) survives, because the value is
 * encoded once and decoded once (the document URI itself is made with `Uri.from`, which keeps the query as given).
 */
export type NuGetContext = { type: 'project' | 'solution'; target: string };

export function nugetEditorQuery(context: NuGetContext): string {
    return new URLSearchParams({ context: context.type, target: context.target }).toString();
}

export function parseNuGetEditorQuery(query: string): NuGetContext {
    const parameters = new URLSearchParams(query);
    return {
        type: parameters.get('context') === 'solution' ? 'solution' : 'project',
        target: parameters.get('target') ?? '',
    };
}
