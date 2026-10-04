// File storage for uploads made from the dashboard.
// Netlify: Netlify Blobs (store "uploads"); local development: files in data/blobs.
// Keys look like "uploads/2026/10/name.webp" and are served at /wp-content/<key>.
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { onNetlify } from './site/files.js';

async function blobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'uploads', consistency: 'strong' });
}

export async function saveFile(key, buffer, contentType) {
  if (onNetlify()) {
    await (await blobStore()).set(key, buffer, { metadata: { contentType } });
  } else {
    const path = `data/blobs/${key}`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
  }
  return `/wp-content/${key}`;
}

export async function readStoredFile(key) {
  if (onNetlify()) {
    const res = await (await blobStore()).getWithMetadata(key, { type: 'arrayBuffer' });
    return res ? { body: Buffer.from(res.data), contentType: res.metadata?.contentType } : null;
  }
  try { return { body: await readFile(`data/blobs/${key}`) }; } catch { return null; }
}

export async function deleteFile(key) {
  if (onNetlify()) await (await blobStore()).delete(key);
  else await unlink(`data/blobs/${key}`).catch(() => {});
}
