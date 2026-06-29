import fs from 'node:fs/promises';
import path from 'node:path';

export const OUTPUT_DIR = path.resolve('OutPut');

function runTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(date)
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.day}.${parts.month}.${parts.year}_${parts.hour}.${parts.minute}`;
}

export async function createOutputRun({ settings, jobs }) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const baseName = runTimestamp();
  let name = baseName;
  let directory;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    name = attempt === 0 ? baseName : `${baseName}_${String(attempt + 1).padStart(2, '0')}`;
    directory = path.join(OUTPUT_DIR, name);
    try {
      await fs.mkdir(directory);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      directory = null;
    }
  }
  if (!directory) {
    throw new Error('Không thể tạo thư mục Output riêng cho lần Run này.');
  }

  const run = {
    name,
    directory,
    manifestPath: path.join(directory, 'manifest.json'),
    manifest: {
      schemaVersion: 1,
      runName: name,
      createdAt: new Date().toISOString(),
      settings,
      jobs: jobs.map((job) => ({
        id: job.id,
        code: job.code,
        prompt: job.prompt,
        tileIds: [],
        status: 'waiting',
        progress: 0,
        results: [],
      })),
    },
  };
  await saveRunManifest(run);
  return run;
}

export async function saveRunManifest(run) {
  run.manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(
    run.manifestPath,
    `${JSON.stringify(run.manifest, null, 2)}\n`,
    'utf8',
  );
}

export function manifestJob(run, jobId) {
  return run.manifest.jobs.find((job) => job.id === jobId);
}

export async function saveOutputMedia(run, fileName, bytes) {
  const safeName = path
    .basename(fileName)
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(0, 120);
  if (!safeName) throw new Error('Tên file output không hợp lệ.');
  const filePath = path.join(run.directory, safeName);
  await fs.writeFile(filePath, bytes);
  return {
    fileName: safeName,
    filePath,
    url: `/output-assets/${encodeURIComponent(run.name)}/${encodeURIComponent(safeName)}`,
  };
}

export function resolveOutputAsset(pathname) {
  const remainder = pathname.replace(/^\/output-assets\//, '');
  const parts = remainder.split('/').map(decodeURIComponent);
  if (parts.length !== 2 || parts.some((part) => !part)) return null;
  const filePath = path.resolve(OUTPUT_DIR, parts[0], parts[1]);
  const relative = path.relative(OUTPUT_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return filePath;
}
