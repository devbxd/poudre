// <img> tags with the same src / srcset / sizes WordPress generates (wp_get_attachment_image).

const dirOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);

function chosen(media, size) {
  const s = (media.sizes || []).find((x) => x.name === size);
  if (s && s.file) return { file: s.file, width: s.width, height: s.height };
  return { file: media.url.split('/').pop(), width: media.width, height: media.height, full: true };
}

export function imageUrl(media, size) {
  if (!media) return '';
  return dirOf(media.url) + chosen(media, size).file;
}

/** wp_image_matches_ratio(): scale the larger image to the smaller width, both sides must match within 1px */
const sameRatio = (sourceW, sourceH, targetW, targetH) => {
  let constrained, expected;
  if (sourceW > targetW) {
    const r = targetW / sourceW;
    constrained = [Math.round(sourceW * r), Math.round(sourceH * r)];
    expected = [targetW, targetH];
  } else {
    const r = sourceW / targetW;
    constrained = [Math.round(targetW * r), Math.round(targetH * r)];
    expected = [sourceW, sourceH];
  }
  return Math.abs(constrained[0] - expected[0]) <= 1 && Math.abs(constrained[1] - expected[1]) <= 1;
};

export function srcset(media, src) {
  const dir = dirOf(media.url);
  const sources = new Map();
  sources.set(src.width, `${dir}${src.file} ${src.width}w`);
  // the full-size file of a GIF is never offered in srcset (it may be animated)
  const full = /\.gif$/i.test(media.url) ? [] : [{ file: media.url.split('/').pop(), width: media.width, height: media.height }];
  const all = [...(media.sizes || []), ...full];
  for (const s of all) {
    if (!s?.file || !s.width || s.width > 2048 || sources.has(s.width)) continue;
    if (!sameRatio(src.width, src.height, s.width, s.height)) continue;
    sources.set(s.width, `${dir}${s.file} ${s.width}w`);
  }
  return sources.size > 1 ? [...sources.values()].join(', ') : '';
}

/**
 * counter: shared { count } so the first images of the page are eager like WordPress
 * (first: fetchpriority="high", next two: no loading attribute, then lazy).
 */
// mode 'attachment': plain wp_get_attachment_image() attribute order (decoding after alt, no lazy loading)
export function imageTag(media, size, { className = '', counter, hover = false, attrs = '', mode = 'loop' } = {}) {
  const src = chosen(media, size);
  const n = counter ? counter.count++ : 99;
  let loading = '';
  if (!hover && n === 0) loading = 'fetchpriority="high" ';
  else if (hover || n > 2) loading = 'loading="lazy" decoding="async" ';
  const set = srcset(media, src);
  const cls = `attachment-${size} size-${size}${className ? ` ${className}` : ''}`;
  if (mode === 'attachment') {
    return `<img width="${src.width}" height="${src.height}" src="${dirOf(media.url)}${src.file}" class="${cls}" alt="${(media.alt || '').replace(/"/g, '&quot;')}" decoding="async"${set ? ` srcset="${set}" sizes="(max-width: ${src.width}px) 100vw, ${src.width}px"` : ''} />`;
  }
  return `<img ${loading}width="${src.width}" height="${src.height}" src="${dirOf(media.url)}${src.file}" class="${cls}" alt="${(media.alt || '').replace(/"/g, '&quot;')}"${attrs}${set ? ` srcset="${set}" sizes="(max-width: ${src.width}px) 100vw, ${src.width}px"` : ''} />`;
}
