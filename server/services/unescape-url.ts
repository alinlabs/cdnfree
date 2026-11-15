export function unescapeUrlText(raw: string): string {
  return raw
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/\\x26/gi, '&');
}
