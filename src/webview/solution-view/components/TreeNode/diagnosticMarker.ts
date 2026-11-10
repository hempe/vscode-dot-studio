import { NodeMarker } from '../../../../types';
import { t } from '../../../shared/i18n';

/** Tooltip text, e.g. "2 errors, 5 warnings" */
export function describeMarker(marker: NodeMarker): string {
    return [
        marker.errors ? t(marker.errors === 1 ? '{0} error' : '{0} errors', marker.errors) : undefined,
        marker.warnings ? t(marker.warnings === 1 ? '{0} warning' : '{0} warnings', marker.warnings) : undefined,
        marker.infos ? t(marker.infos === 1 ? '{0} info' : '{0} infos', marker.infos) : undefined,
    ].filter(Boolean).join(', ');
}
