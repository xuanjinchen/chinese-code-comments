export const HTML_MARKERS = Object.freeze({
  start: '<!-- chinese-code-comments:start -->',
  end: '<!-- chinese-code-comments:end -->',
});

export const VISIBLE_MARKERS = Object.freeze({
  start: '## chinese-code-comments managed policy: start',
  end: '## chinese-code-comments managed policy: end',
});

export function renderPolicy(adapter, template, eol) {
  if (eol !== '\n' && eol !== '\r\n') {
    throw new Error('Policy EOL must be LF or CRLF');
  }

  const normalizedTemplate = template.replace(/\r\n?|\n/g, '\n').trim();
  const body = normalizedTemplate
    .replaceAll('{{skill_invocation}}', adapter.invocation)
    .replaceAll('\n', eol);

  return [adapter.markers.start, body, adapter.markers.end, ''].join(eol);
}
