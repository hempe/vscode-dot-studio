/** A template option (template.json parameter) under its `dotnet new` CLI name */
export interface TemplateOption {
    /** CLI name without dashes, e.g. `use-controllers` */
    readonly name: string;
    /** Parameter name in template.json, e.g. `UseControllers` */
    readonly symbol: string;
    readonly type: 'bool' | 'choice' | 'text' | 'number';
    readonly label: string;
    readonly defaultValue?: string;
    readonly choices?: { readonly value: string; readonly description: string }[];
}

/** An installed `dotnet new` template */
export interface TemplateInfo {
    readonly identity: string;
    readonly name: string;
    readonly shortName: string;
    readonly description: string;
    /** C#, F#, VB; none for config files */
    readonly language?: string;
    /** project, item, solution, ... */
    readonly type: string;
    readonly tags: string[];
    readonly defaultName?: string;
    readonly options: TemplateOption[];
}

/** A template as the wizard lists it: a `dotnet new` template or a built-in C# item (Class, Interface, ...) */
export interface WizardTemplate {
    /** `builtin:class` or the template identity */
    readonly id: string;
    readonly name: string;
    readonly shortName?: string;
    readonly description: string;
    readonly language?: string;
    readonly tags: string[];
    readonly recent?: boolean;
    /** Prefilled name, e.g. Class1.cs, ClassLibrary1 */
    readonly defaultName: string;
    /** Config files and the like don't get a name */
    readonly needsName: boolean;
    readonly options: TemplateOption[];
}

export interface WizardInit {
    readonly kind: 'project' | 'item';
    readonly title: string;
    readonly templates: WizardTemplate[];
    /** Project: folder new projects go in, relative to the solution (the name is appended); item: the target folder */
    readonly location: string;
    /** Values the wizard preselects instead of the template defaults, e.g. the solution's framework */
    readonly preferredValues: Record<string, string>;
    /** Visual Studio's "Create a new project": a new solution; `location` is then the folder it goes in (absolute) */
    readonly newSolution?: boolean;
}

/** Webview → extension */
export type WizardRequest =
    | { readonly type: 'ready' }
    | {
        readonly type: 'create'; readonly templateId: string; readonly name: string; readonly location?: string; readonly values: Record<string, string | boolean>;
        /** New solution only */
        readonly solutionName?: string; readonly sameDirectory?: boolean;
    }
    | { readonly type: 'browseFolder'; readonly current: string }
    | { readonly type: 'cancel' };

/** Extension → webview */
export type WizardMessage =
    | { readonly type: 'init'; readonly payload: WizardInit }
    | { readonly type: 'busy'; readonly busy: boolean }
    | { readonly type: 'folderPicked'; readonly path: string }
    | { readonly type: 'error'; readonly message: string };
