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

export function isSensitiveParamName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return SENSITIVE_PARAM_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function redactUrlForDisplay(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }

    const keys = Array.from(parsed.searchParams.keys());
    let modified = false;
    for (const key of keys) {
      if (isSensitiveParamName(key)) {
        parsed.searchParams.set(key, 'REDACTED');
        modified = true;
      }
    }

    if (!modified && !rawUrl.includes('@')) {
      return parsed.toString();
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
