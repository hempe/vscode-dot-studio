import { NodeMarker } from '../../../../types';

/** The count shown in a file's badge: the count at the marker's severity */
export function markerCount(marker: NodeMarker): number {
    switch (marker.severity) {
        case 'error': return marker.errors;
        case 'warning': return marker.warnings;
        case 'info': return marker.infos;
    }
}

/** Tooltip text, e.g. "2 errors, 5 warnings" */
export function describeMarker(marker: NodeMarker): string {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return [
        marker.errors ? plural(marker.errors, 'error') : undefined,
        marker.warnings ? plural(marker.warnings, 'warning') : undefined,
        marker.infos ? plural(marker.infos, 'info') : undefined,
    ].filter(Boolean).join(', ');
}
