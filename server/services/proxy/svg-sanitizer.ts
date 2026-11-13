export function sanitizeSvgXml(rawSvg: string): string {
  return rawSvg
    // Remove script elements and foreignObject blocks that can embed arbitrary HTML/JS
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*\/\s*>/gi, '')
    // Strip inline event handler attributes (onload, onclick, onerror, etc.)
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralize javascript:/vbscript:/data:text/html links inside SVG attributes
    .replace(
      /\b((?:xlink:)?href|src)\s*=\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^']*')/gi,
      '$1="#"',
    );
}
