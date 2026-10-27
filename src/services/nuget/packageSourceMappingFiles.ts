import * as fs from 'fs';
import { mergeSourceMappings, parseSourceMapping, SourceMapping } from './packageSourceMapping';
import { nugetConfigFiles } from './nugetCredentials';

/** The Package Source Mapping of every NuGet.Config NuGet reads for `startDir`, combined */
export function readSourceMapping(startDir: string): SourceMapping {
    return mergeSourceMappings(nugetConfigFiles(startDir).map(file => {
        try {
            return parseSourceMapping(fs.readFileSync(file, 'utf8'));
        } catch {
            return {};
        }
    }));
}
