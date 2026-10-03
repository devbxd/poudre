// Serves /wp-content/uploads/* exactly like WordPress did:
// originals as-is, and resized copies ("name-500x500.webp") generated on demand with the same dimensions.
import { readFile } from 'node:fs/promises';
import { readStoredFile, saveFile } from './storage.js';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };
const mimeOf = (p) => MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';
const CACHE = { 'Cache-Control': 'public, max-age=31536000, immutable', 'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable' };

/** Original file bytes: local copy in development, the static deploy (or blob store) in production. */
async function loadOriginal(path, origin, internal) {
  if (!process.env.NETLIFY) {
    try { return await readFile(`data/uploads/${path}`); } catch { /* not a WordPress original */ }
  }
  const stored = await readStoredFile(`uploads/${path}`);
  if (stored) return stored.body;
  if (process.env.NETLIFY && origin && !internal) {
    // WordPress originals are deployed as static files; a missing file comes back here, so never loop
    const res = await fetch(`${origin}/wp-content/uploads/${path}`, { headers: { 'x-poudre-internal': '1' } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

export async function serveUpload(c) {
  const path = decodeURIComponent(c.req.path.replace(/^\/wp-content\/uploads\//, ''));
  if (path.includes('..')) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const internal = !!c.req.header('x-poudre-internal');

  const direct = await loadOriginal(path, origin, internal);
  if (direct) return c.body(direct, 200, { 'Content-Type': mimeOf(path), ...CACHE });

  const m = path.match(/^(.*)-(\d+)x(\d+)\.([a-z0-9]+)$/i);
  if (!m) return c.notFound();
  const [, base, w, h, ext] = m;
  // WordPress keeps the un-suffixed name for sizes of "-scaled" originals
  let original = null;
  for (const candidate of [`${base}.${ext}`, `${base}-scaled.${ext}`]) {
    original = await loadOriginal(candidate, origin, internal);
    if (original) break;
  }
  if (!original) return c.notFound();

  const { default: sharp } = await import('sharp');
  let img = sharp(original).rotate().resize(Number(w), Number(h), { fit: 'cover', position: 'centre' });
  if (/jpe?g/i.test(ext)) img = img.jpeg({ quality: 82, mozjpeg: true });
  else if (/webp/i.test(ext)) img = img.webp({ quality: 82 });
  else if (/png/i.test(ext)) img = img.png({ compressionLevel: 9 });
  const out = await img.toBuffer();
  // keep a copy so the next cold start does not resize again
  saveFile(`uploads/${path}`, out, mimeOf(path)).catch(() => {});
  return c.body(out, 200, { 'Content-Type': mimeOf(path), ...CACHE });
}

/** WordPress-like size set generated for images uploaded from the dashboard. */
export function sizesFor(width, height) {
  const fit = (maxW, maxH) => {
    const r = Math.min(maxW / width, maxH / height, 1);
    return { width: Math.round(width * r), height: Math.round(height * r) };
  };
  const crop = (s) => ({ width: Math.min(s, width), height: Math.min(s, height) });
  return {
    thumbnail: crop(150),
    medium: fit(320, 320),
    medium_large: fit(768, 99999),
    large: fit(960, 640),
    woocommerce_thumbnail: fit(500, 99999),
    woocommerce_single: fit(800, 99999),
    woocommerce_gallery_thumbnail: crop(150),
    'woosc-small': fit(96, 96),
    'woosc-large': fit(600, 600),
  };
}
