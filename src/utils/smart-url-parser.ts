import {
  type NormalizeUrlResult,
  normalizeUrlInput,
} from './normalize-url.ts';
import {
  EXPLICIT_GLUED_EXTENSIONS_RE,
  isDomainLikeHost,
  isExplicitUrlToken,
  isTldLikeSuffix,
  NON_URL_FILE_EXTENSIONS,
  tokenizeLine,
} from './smart-url-tokens.ts';

export interface RejectedUrlCandidate {
  raw: string;
  reason: Exclude<NormalizeUrlResult, { ok: true }>['reason'];
  message: string;
}

export interface ExtractUrlsResult {
  validUrls: string[];
  rejectedCandidates: RejectedUrlCandidate[];
  ignoredNoiseCount: number;
}

function isStandaloneUrlStart(tokens: string[], index: number): boolean {
  const token = tokens[index]?.replace(/^[(\[]+/, '').replace(/[.,;:!?)\]]+$/, '');
  if (!token) return false;

  if (isExplicitUrlToken(token)) {
    return true;
  }

  // Host + optional path/query/port attached directly
  const hostSplit = token.split(/[/?#]/);
  const hostPart = hostSplit[0] ?? '';
  const hasPathOrQuery = hostSplit.length > 1;
  if (isDomainLikeHost(hostPart, hasPathOrQuery)) {
    return true;
  }

  // Space-broken domain label followed by ".com" or ". com" (e.g. "alvareza .com/video")
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(token)) {
    const next = tokens[index + 1];
    if (next && next.startsWith('.') && isTldLikeSuffix(next)) {
      return true;
    }
    if (next === '.' && tokens[index + 2] && isTldLikeSuffix(tokens[index + 2])) {
      return true;
    }
  }

  return false;
}

function trimSurroundingPunctuation(candidate: string): string {
  let out = candidate.trim().replace(/^[('"\[]+/, '');

  // Strip trailing sentence punctuation while preserving balanced parentheses like Wikipedia URLs
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === ')') {
      const openCount = (out.match(/\(/g) ?? []).length;
      const closeCount = (out.match(/\)/g) ?? []).length;
      if (closeCount > openCount) {
        out = out.slice(0, -1);
        continue;
      }
      break;
    }
    if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === ']') {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }

  return out;
}

function shouldStitchAfterSlash(
  tokens: string[],
  afterSlashIndex: number,
  currentUrl: string,
): boolean {
  const after = tokens[afterSlashIndex];
  if (!after) return false;
  if (isExplicitUrlToken(after)) return false;

  // If after looks like another distinct site (e.g. "a.com / b.com"), "/" was a separator
  const afterHost = after.split(/[/?#]/)[0] ?? '';
  if (!currentUrl.endsWith('/') && isDomainLikeHost(afterHost, false)) {
    return false;
  }

  // Stitch if after contains path/ext/query markers or the next token continues with .ext / / / ?
  if (/[./?=&:#]/.test(after)) {
    return true;
  }

  const nextAfter = tokens[afterSlashIndex + 1];
  if (
    nextAfter &&
    (/^[./?&#=]/.test(nextAfter) || nextAfter === '.')
  ) {
    return true;
  }

  return false;
}

function endsWithTrailingDotInPath(current: string): boolean {
  if (!current.endsWith('.')) return false;
  const withoutScheme = current.replace(/^https?:\/\//i, '');
  // If slash exists, trailing dot is in path/filename (e.g. "alvareza.com/video.")
  if (withoutScheme.includes('/')) return true;
  // Otherwise it might be "alvareza." before "com"
  const labels = withoutScheme.slice(0, -1).split('.');
  const lastLabel = labels[labels.length - 1] ?? '';
  return labels.length === 1 || lastLabel.length > 4;
}

function extractCandidatesFromLine(rawLine: string): {
  candidates: string[];
  ignoredTokens: number;
} {
  const tokens = tokenizeLine(rawLine);
  const candidates: string[] = [];
  let ignoredTokens = 0;

  let i = 0;
  while (i < tokens.length) {
    if (!isStandaloneUrlStart(tokens, i)) {
      ignoredTokens += 1;
      i += 1;
      continue;
    }

    let current = tokens[i].replace(/^[('"\[]+/, '');
    let j = i + 1;

    while (j < tokens.length) {
      const next = tokens[j];

      // Break cleanly before any new explicit scheme unless query param expects it right after =/?/&
      if (isExplicitUrlToken(next)) {
        if (/[=?&]$/.test(current)) {
          current += next;
          j += 1;
          continue;
        }
        break;
      }

      // Case 1: ".mp4", ".com/video", ".mp4?v=1"
      if (/^\.[a-z0-9_-]+/i.test(next) && !next.startsWith('..')) {
        current += next;
        j += 1;
        continue;
      }

      // Case 2: separated dot "." + "mp4" or "." + "com/video"
      if (
        next === '.' &&
        j + 1 < tokens.length &&
        /^[a-z0-9_-]+(?:[/?#].*)?$/i.test(tokens[j + 1])
      ) {
        const following = tokens[j + 1];
        const firstPart = following.split(/[/?#]/)[0]?.toLowerCase() ?? '';
        const hasValidJoinSuffix =
          current.includes('/') ||
          isTldLikeSuffix(`.${firstPart}`) ||
          NON_URL_FILE_EXTENSIONS.has(firstPart);

        if (hasValidJoinSuffix) {
          current += `.${following}`;
          j += 2;
          continue;
        }
        break;
      }

      // Case 3: Query / hash delimiters "?...", "&...", "#...", "=..."
      if (next === '?' || next === '&' || next === '#' || next === '=') {
        if (next === '=' && !current.includes('?')) {
          break;
        }
        const valueToken = tokens[j + 1];
        if (
          valueToken &&
          !isExplicitUrlToken(valueToken) &&
          /^[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/i.test(valueToken)
        ) {
          current += `${next}${valueToken}`;
          j += 2;
          continue;
        }
        break;
      }

      if (/^[?&#=][a-z0-9._~/%+-]/i.test(next)) {
        if (next.startsWith('=') && !current.includes('?')) {
          break;
        }
        current += next;
        j += 1;
        continue;
      }

      // Case 4: Slash continuation "/video" or " / video .mp4"
      if (next === '/') {
        if (shouldStitchAfterSlash(tokens, j + 1, current)) {
          const prefix = current.endsWith('/') ? '' : '/';
          current += `${prefix}${tokens[j + 1]}`;
          j += 2;
          continue;
        }
        break;
      }

      if (/^\/(?!\/)[^\s]+/.test(next)) {
        const prefix = current.endsWith('/') ? current.slice(0, -1) : current;
        current = `${prefix}${next}`;
        j += 1;
        continue;
      }

      // Case 5: Port continuation ":8443/v1"
      if (/^:\d{1,5}(?:[/?#].*)?$/.test(next) && !current.replace(/^https?:\/\//i, '').includes('/')) {
        current += next;
        j += 1;
        continue;
      }

      // Case 6: Current ends in '.', '?', '&', '='
      if (endsWithTrailingDotInPath(current) && /^[a-z0-9_-]{1,16}(?:[/?#].*)?$/i.test(next)) {
        current += next;
        j += 1;
        continue;
      }

      if (/[?&=]$/.test(current) && /^[a-z0-9._~/%+-]+(?:=[^\s]*)?$/i.test(next)) {
        current += next;
        j += 1;
        continue;
      }

      break;
    }

    const trimmedCandidate = trimSurroundingPunctuation(current);
    if (trimmedCandidate) {
      candidates.push(trimmedCandidate);
    }
    i = j;
  }

  return { candidates, ignoredTokens };
}

function shouldReportRejectedCandidate(candidate: string): boolean {
  if (isExplicitUrlToken(candidate)) return true;
  const host = candidate.split(/[/?#]/)[0]?.toLowerCase() ?? '';
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(host) ||
    host.startsWith('[')
  );
}

export function extractUrlsFromInput(rawInput: string): ExtractUrlsResult {
  const validUrls: string[] = [];
  const seenValid = new Set<string>();
  const rejectedCandidates: RejectedUrlCandidate[] = [];
  let ignoredNoiseCount = 0;

  const lines = rawInput.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const { candidates, ignoredTokens } = extractCandidatesFromLine(line);
    ignoredNoiseCount += ignoredTokens;

    for (const candidate of candidates) {
      const normalized = normalizeUrlInput(candidate);
      if (normalized.ok) {
        if (!seenValid.has(normalized.normalizedUrl)) {
          seenValid.add(normalized.normalizedUrl);
          validUrls.push(normalized.normalizedUrl);
        }
        continue;
      }

      if (shouldReportRejectedCandidate(candidate)) {
        rejectedCandidates.push({
          raw: candidate,
          reason: normalized.reason,
          message: normalized.message,
        });
      } else {
        ignoredNoiseCount += 1;
      }
    }
  }

  return {
    validUrls,
    rejectedCandidates,
    ignoredNoiseCount,
  };
}

export interface SmartSingleUrlAnalysis {
  extractedCount: number;
  allValidUrls: string[];
  hadRepairsOrNoise: boolean;
  outcome: NormalizeUrlResult;
}

export function parseSingleSearchInput(rawInput: string): SmartSingleUrlAnalysis {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      extractedCount: 0,
      allValidUrls: [],
      hadRepairsOrNoise: false,
      outcome: normalizeUrlInput(trimmed),
    };
  }

  // Fast path: already a clean single URL without spaces or glued schemes
  const direct = normalizeUrlInput(trimmed);
  const schemeMatches = trimmed.match(/https?:\/\//gi) ?? [];
  const mayHaveGluedScheme = schemeMatches.length > 1;
  EXPLICIT_GLUED_EXTENSIONS_RE.lastIndex = 0;
  const mayHaveGluedExtension = EXPLICIT_GLUED_EXTENSIONS_RE.test(trimmed);
  EXPLICIT_GLUED_EXTENSIONS_RE.lastIndex = 0;

  if (direct.ok && !mayHaveGluedScheme && !mayHaveGluedExtension) {
    return {
      extractedCount: 1,
      allValidUrls: [direct.normalizedUrl],
      hadRepairsOrNoise: false,
      outcome: direct,
    };
  }

  const extracted = extractUrlsFromInput(trimmed);
  if (extracted.validUrls.length > 0) {
    const firstValid = normalizeUrlInput(extracted.validUrls[0]);
    if (firstValid.ok) {
      return {
        extractedCount: extracted.validUrls.length,
        allValidUrls: extracted.validUrls,
        hadRepairsOrNoise:
          extracted.validUrls.length > 1 ||
          extracted.ignoredNoiseCount > 0 ||
          /\s/.test(trimmed),
        outcome: firstValid,
      };
    }
  }

  if (extracted.rejectedCandidates.length > 0) {
    const firstRejected = extracted.rejectedCandidates[0];
    return {
      extractedCount: 0,
      allValidUrls: [],
      hadRepairsOrNoise: false,
      outcome: {
        ok: false,
        reason: firstRejected.reason,
        message: firstRejected.message,
      },
    };
  }

  return {
    extractedCount: 0,
    allValidUrls: [],
    hadRepairsOrNoise: false,
    outcome: direct.ok
      ? direct
      : {
          ok: false,
          reason: 'INVALID_FORMAT',
          message:
            'Tidak ditemukan URL situs yang valid. Contoh: https://contoh.com atau contoh.com/video.mp4.',
        },
  };
}
