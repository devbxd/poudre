// Paths that work both locally and inside the Netlify function bundle (included_files keep their repo path).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const onNetlify = () => !!(process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY);
const ROOT = process.env.LAMBDA_TASK_ROOT || fileURLToPath(new URL('../../', import.meta.url));
export const templateFile = (name) => join(ROOT, 'site', 'templates', name);
export const rootFile = (rel) => join(ROOT, rel);
