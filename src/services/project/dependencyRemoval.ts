import { ProjectFileEditor } from '../parsers/projectFileEditor';

const ELEMENT: Record<string, string> = {
    packages: 'PackageReference',
    projects: 'ProjectReference',
    assemblies: 'Reference',
    frameworks: 'FrameworkReference',
};

/** The name a reference goes by in the Dependencies tree */
function nameOf(category: string, include: string): string {
    switch (category) {
        case 'projects': {
            const file = include.split(/[\\/]/).pop() ?? include;
            return file.replace(/\.[A-Za-z]+proj$/i, '');
        }
        case 'assemblies':
            // `Legacy, Version=1.2.0.0, Culture=neutral, PublicKeyToken=...` is shown as Legacy
            return include.split(',')[0].trim();
        default:
            return include;
    }
}

/**
 * The project file text without the reference `name` of the category (packages, projects, assemblies, frameworks), edited as
 * text so comments, blank lines and line endings stay; `undefined` when there is no such reference.
 */
export function removeDependencyEdit(content: string, category: string, name: string): string | undefined {
    const element = ELEMENT[category];
    if (!element) {
        return undefined;
    }
    const result = ProjectFileEditor.removeItems(content, element, include => nameOf(category, include).toLowerCase() === name.toLowerCase());
    return result.removed ? result.content : undefined;
}
