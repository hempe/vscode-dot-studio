import * as xml2js from 'xml2js';

/**
 * The target frameworks a project file declares: `TargetFrameworks` (several, separated by `;`) or `TargetFramework`
 */
export async function parseTargetFrameworks(projectXml: string): Promise<string[]> {
    const project = await new xml2js.Parser().parseStringPromise(projectXml);
    const frameworks: string[] = [];
    for (const group of project?.Project?.PropertyGroup ?? []) {
        const plural = group.TargetFrameworks?.[0];
        const singular = group.TargetFramework?.[0];
        if (typeof plural === 'string') {
            frameworks.push(...plural.split(';').map(framework => framework.trim()).filter(Boolean));
        } else if (typeof singular === 'string') {
            frameworks.push(singular.trim());
        }
    }
    return frameworks;
}

/** .NET Framework target frameworks (`net20` ... `net481`): they run on Mono or Windows, make an `.exe` and have no `dotnet watch` */
export function isNetFrameworkTarget(framework: string | null | undefined): boolean {
    return /^net[1-4]\d{1,2}$/i.test(framework ?? '');
}
