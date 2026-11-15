import type { InspectionResult } from '../../../types/inspection';
import { deriveInspectionDetails } from '../../../utils/inspection-details';
import { AnalysisLimitationsSection } from './analysis-limitations-section';
import { BlockingSummarySection } from './blocking-summary-section';
import { CdnHostsSection } from './cdn-hosts-section';
import { DetailOverviewSection } from './detail-overview-section';
import { RedirectChain } from './redirect-chain';
import { ReviewFindingsSection } from './review-findings-section';
import { SuspiciousLinks } from './suspicious-links';

interface TabDetailProps {
  result: InspectionResult;
}

export function TabDetail({ result }: TabDetailProps) {
  const details = deriveInspectionDetails(result);

  return (
    <div
      id="panel-detail"
      role="region"
      aria-label="Detail & Inspeksi"
      className="space-y-6"
    >
      <DetailOverviewSection result={result} details={details} />

      <RedirectChain
        redirects={result.redirects}
        finalUrl={result.finalUrl}
        finalStatusCode={result.page.statusCode}
      />

      <CdnHostsSection cdnHosts={result.cdnHosts} />

      <ReviewFindingsSection
        reviewLinks={details.reviewLinks}
        flaggedResources={details.flaggedResources}
        totalCount={details.reviewTotalCount}
      />

      <BlockingSummarySection
        summary={result.summary}
        flaggedResourceCount={details.flaggedResources.length}
      />

      <SuspiciousLinks links={result.links} />

      <AnalysisLimitationsSection limitations={details.limitations} />
    </div>
  );
}
