import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'config', 'ai-provider-catalog.json');

export async function getProviderCatalog() {
  const raw = await fs.readFile(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(raw);

  if (!catalog?.categories || typeof catalog.categories !== 'object') {
    throw new Error('Invalid AI provider catalog: missing categories');
  }

  for (const key of ['api', 'endpoint', 'oauth']) {
    if (!Array.isArray(catalog.categories[key])) {
      catalog.categories[key] = [];
    }
  }

  return catalog;
}
