import fs from 'node:fs/promises';
import path from 'node:path';

export const REGISTRY_PATH = path.resolve('artifacts', 'flow-ui-registry.json');

function emptyRegistry() {
  return {
    schemaVersion: 1,
    app: 'google-flow',
    updatedAt: new Date().toISOString(),
    controls: {},
  };
}

export async function loadRegistry(registryPath = REGISTRY_PATH) {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 1 || !parsed.controls) {
      throw new Error('Unsupported registry schema.');
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyRegistry();
    throw error;
  }
}

export async function saveControl(entry, registryPath = REGISTRY_PATH) {
  const registry = await loadRegistry(registryPath);
  registry.updatedAt = new Date().toISOString();
  registry.controls[entry.key] = entry;
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  return registry.controls[entry.key];
}

export async function resetRegistry(registryPath = REGISTRY_PATH) {
  let backupPath = null;
  try {
    await fs.access(registryPath);
    const backupDir = path.join(path.dirname(registryPath), 'backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(
      backupDir,
      `flow-ui-registry.${stamp}.json`,
    );
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(registryPath, backupPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const registry = emptyRegistry();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  return { backupPath, registryPath };
}
