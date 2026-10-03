/** Index just after the closing tag of the element that starts at `start`. */
export function elementEnd(html, start) {
  const tag = html.slice(start + 1).match(/^[a-zA-Z0-9]+/)[0];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`No end for <${tag}> at ${start}`);
}

