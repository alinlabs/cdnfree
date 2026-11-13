import {
  submitInspectionRequest,
  type InspectionApiOutcome,
} from '../../../services/inspection-service';
import { loadSettings } from '../../../services/settings-service';

export function runInspectForUrl(
  normalizedUrl: string,
  signal?: AbortSignal,
): Promise<InspectionApiOutcome> {
  const settings = loadSettings().data;
  return submitInspectionRequest(
    {
      url: normalizedUrl,
      options: {
        includeStaticLinks: true,
        includeResources: true,
        enableFilterMatching: settings.protection.enableFilterMatching,
        warnSuspiciousLinks: settings.protection.warnSuspiciousLinks,
        rejectProtocolDowngrade: settings.protection.rejectProtocolDowngrade,
        allowlistedHosts: settings.allowlistedHosts,
      },
    },
    signal,
  );
}
