import { NodeMarker } from '../../../../types';

/** Tooltip text, e.g. "2 errors, 5 warnings" */
export function describeMarker(marker: NodeMarker): string {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return [
        marker.errors ? plural(marker.errors, 'error') : undefined,
        marker.warnings ? plural(marker.warnings, 'warning') : undefined,
        marker.infos ? plural(marker.infos, 'info') : undefined,
    ].filter(Boolean).join(', ');
}
