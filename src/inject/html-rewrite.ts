const BODY_OPEN = /<body\b([^>]*)>/i;

export function rewriteBodyTag(html: string, buildId: string): string {
  const m = html.match(BODY_OPEN);
  if (!m) return html;
  const attrs = m[1] ?? "";
  let newAttrs: string;
  if (/\bdata-flip-build-id\s*=/i.test(attrs)) {
    newAttrs = attrs.replace(
      /\bdata-flip-build-id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
      `data-flip-build-id="${buildId}"`,
    );
  } else {
    newAttrs = attrs.trimEnd() + ` data-flip-build-id="${buildId}"`;
    if (!attrs.startsWith(" ")) newAttrs = " " + newAttrs.trimStart();
  }
  return html.replace(BODY_OPEN, `<body${newAttrs}>`);
}
