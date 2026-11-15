const SENSITIVE_PARAM_PATTERNS = [
  /token/i,
  /auth/i,
  /key/i,
  /secret/i,
  /pass(word|wd)?/i,
  /pwd/i,
  /session/i,
  /^sid$/i,
  /cookie/i,
  /credential/i,
  /sig(nature)?/i,
  /jwt/i,
  /bearer/i,
  /^code$/i,
  /state/i,
];

export function redactUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = '';
    parsed.password = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_PARAM_PATTERNS.some((p) => p.test(key))) {
        parsed.searchParams.set(key, 'REDACTED');
      }
    }
    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
}

export interface FramePolicyEvaluation {
  embeddable: boolean;
  reason?: string;
}

function toHeaderList(
  header: string | string[] | undefined,
): string[] {
  if (!header) return [];
  const raw = Array.isArray(header) ? header : [header];
  return raw.map((item) => item.trim()).filter(Boolean);
}

export function evaluateFramePolicy(
  xFrameOptionsHeader: string | string[] | undefined,
  cspHeader: string | string[] | undefined,
): FramePolicyEvaluation {
  for (const xfoEntry of toHeaderList(xFrameOptionsHeader)) {
    const normalized = xfoEntry.toLowerCase();
    if (
      normalized.includes('deny') ||
      normalized.includes('sameorigin') ||
      normalized.includes('allow-from')
    ) {
      return {
        embeddable: false,
        reason:
          'Situs tujuan menetapkan header X-Frame-Options yang melarang penyematan lintas-asal.',
      };
    }
  }

  for (const cspEntry of toHeaderList(cspHeader)) {
    // HTTP header combining can concatenate multiple CSP policies with commas
    const policies = cspEntry.split(',');
    for (const policy of policies) {
      const directives = policy.split(';');
      for (const directive of directives) {
        const trimmed = directive.trim().toLowerCase();
        if (trimmed === 'frame-ancestors' || trimmed.startsWith('frame-ancestors ')) {
          const value = trimmed.slice('frame-ancestors'.length).trim();
          const tokens = value.split(/\s+/).filter(Boolean);

          if (tokens.includes("'none'") || tokens.length === 0) {
            return {
              embeddable: false,
              reason:
                "Situs tujuan melarang semua penyematan melalui Content-Security-Policy (frame-ancestors 'none').",
            };
          }

          if (!tokens.includes('*')) {
            if (tokens.length === 1 && tokens[0] === "'self'") {
              return {
                embeddable: false,
                reason:
                  "Situs tujuan hanya mengizinkan penyematan di domainnya sendiri (frame-ancestors 'self').",
              };
            }
            return {
              embeddable: false,
              reason:
                'Situs tujuan membatasi penyematan ke asal tertentu melalui Content-Security-Policy frame-ancestors.',
            };
          }
        }
      }
    }
  }

  return { embeddable: true };
}
