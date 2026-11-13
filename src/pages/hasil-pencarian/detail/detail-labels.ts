import type { InspectionResult, LinkRecord } from '../../../types/inspection';
import { redactUrlForDisplay } from '../../../utils/redact-url';

export type LinkFilterMode =
  | 'all'
  | 'review'
  | 'ad-or-tracker'
  | 'ordinary'
  | 'unknown';

export interface LinkClassificationBadge {
  text: string;
  toneClass: string;
}

export function getLinkClassificationBadge(
  classification: LinkRecord['classification'],
): LinkClassificationBadge {
  switch (classification) {
    case 'known-malicious':
      return {
        text: 'Diketahui berbahaya',
        toneClass: 'text-[var(--color-danger)] font-semibold',
      };
    case 'suspicious':
      return {
        text: 'Perlu ditinjau',
        toneClass: 'text-[var(--color-danger)] font-medium',
      };
    case 'ad-or-tracker':
      return {
        text: 'Cocok daftar filter (iklan/pelacak)',
        toneClass: 'text-[var(--color-amber-strong)] font-medium',
      };
    case 'unknown':
      return {
        text: 'Tidak diketahui',
        toneClass: 'text-[var(--color-text-soft)]',
      };
    default:
      return {
        text: 'Tautan biasa',
        toneClass: 'text-[var(--color-text-muted)]',
      };
  }
}

export function filterPageLinks(
  links: LinkRecord[],
  query: string,
  filterMode: LinkFilterMode,
): LinkRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return links.filter((link) => {
    if (filterMode === 'review') {
      if (
        link.classification !== 'suspicious' &&
        link.classification !== 'known-malicious'
      ) {
        return false;
      }
    } else if (filterMode !== 'all' && link.classification !== filterMode) {
      return false;
    }

    if (!normalizedQuery) return true;
    return (
      link.href.toLowerCase().includes(normalizedQuery) ||
      link.host.toLowerCase().includes(normalizedQuery) ||
      (link.text ?? '').toLowerCase().includes(normalizedQuery)
    );
  });
}

export function getMetaRefreshSummary(
  hint: NonNullable<InspectionResult['page']['metaRefreshHint']>,
): string {
  const targetPart = hint.targetUrl
    ? `Menunjuk ke ${redactUrlForDisplay(hint.targetUrl)}`
    : 'Target meta refresh tidak valid atau ditolak kebijakan keamanan.';
  const delayPart =
    typeof hint.delaySeconds === 'number'
      ? ` (jeda ${hint.delaySeconds} detik)`
      : '';
  return `${targetPart}${delayPart}`;
}
