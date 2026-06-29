import fs from 'node:fs/promises';
import path from 'node:path';

export const BATCH_PATH = path.resolve(
  'artifacts',
  'batch',
  'project.json',
);
export const REFERENCE_DIR = path.resolve(
  'artifacts',
  'batch',
  'references',
);
export const WORKSPACE_DIR = path.resolve(
  'artifacts',
  'batch',
  'workspaces',
);
export const WORKSPACE_INDEX_PATH = path.resolve(
  'artifacts',
  'batch',
  'workspaces.json',
);

const DEFAULT_PROMPTS = [
  'A cinematic establishing shot of a futuristic coastal city at blue hour, glowing architecture, natural atmospheric depth, premium editorial composition.',
  'Close portrait of the main character under soft window light, realistic skin texture, confident expression, shallow depth of field, clean background.',
  'A dynamic street scene in light rain, reflections across dark pavement, subtle motion blur, dramatic practical lighting, coherent character design.',
  'Wide aerial view above layered mountain valleys at sunrise, volumetric clouds, warm rim light, highly detailed but natural color grading.',
  'Minimal product composition on a sculpted stone pedestal, soft cyan and amber lighting, precise shadows, luxury advertising photography.',
  'An intimate interior scene with the character reading beside a large window, quiet mood, warm practical lights, cinematic framing.',
];

function defaultBatch() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      mode: 'Image',
      model: 'Nano Banana Pro',
      aspect: '16:9',
      count: '1x',
      submitDelayMs: 2500,
    },
    jobs: DEFAULT_PROMPTS.map((prompt, index) => ({
      id: index + 1,
      code: `S${Math.floor(index / 3) + 1}.${(index % 3) + 1}`,
      selected: index < 2,
      prompt,
      references: [null, null, null, null, null],
      result: index === 0 ? 'demo' : null,
      results: [],
      progress: index === 0 ? 100 : 0,
      runFolder: null,
      status: index === 0 ? 'done' : index === 4 ? 'error' : 'waiting',
    })),
  };
}

function blankBatch() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      mode: 'Image',
      model: 'Nano Banana Pro',
      aspect: '16:9',
      count: '1x',
      submitDelayMs: 2500,
    },
    jobs: [
      {
        id: 1,
        code: 'S1.1',
        selected: true,
        prompt: '',
        references: [null, null, null, null, null],
        result: null,
        results: [],
        progress: 0,
        runFolder: null,
        status: 'waiting',
      },
    ],
  };
}

function cleanText(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

export function normalizeBatch(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Batch payload must be an object.');
  }
  if (!Array.isArray(input.jobs) || input.jobs.length > 500) {
    throw new Error('Batch must contain between 0 and 500 jobs.');
  }
  const allowedModes = new Set(['Image', 'Video', 'Frames to Video']);
  const allowedModels = new Set([
    'Nano Banana Pro',
    'Nano Banana 2',
    'Veo 3.1',
    'Veo 3.1 Fast',
  ]);
  const allowedAspects = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
  const allowedCounts = new Set(['1x', '2x', '3x', '4x']);
  const settings = input.settings || {};
  const submitDelayMs = Number(settings.submitDelayMs);

  const seenIds = new Set();
  const jobs = input.jobs.map((job, index) => {
    const id = Number(job.id);
    if (!Number.isInteger(id) || id < 1 || seenIds.has(id)) {
      throw new Error(`Invalid or duplicate job id at row ${index + 1}.`);
    }
    seenIds.add(id);
    const references = Array.isArray(job.references)
      ? job.references.slice(0, 5)
      : [];
    while (references.length < 5) references.push(null);
    const results = Array.isArray(job.results)
      ? job.results
          .filter(
            (result) =>
              typeof result === 'string' &&
              result.startsWith('/output-assets/'),
          )
          .slice(0, 4)
      : [];
    const progress = Number(job.progress);
    return {
      id,
      code: cleanText(job.code, 40),
      selected: Boolean(job.selected),
      prompt: cleanText(job.prompt, 20_000),
      references: references.map((reference) =>
        typeof reference === 'string' &&
        reference.startsWith('/batch-assets/')
          ? reference
          : null,
      ),
      result:
        typeof job.result === 'string'
          ? cleanText(job.result, 500)
          : null,
      results,
      progress:
        Number.isFinite(progress) && progress >= 0 && progress <= 100
          ? Math.round(progress)
          : 0,
      runFolder:
        typeof job.runFolder === 'string'
          ? cleanText(job.runFolder, 80)
          : null,
      status: ['waiting', 'running', 'done', 'error'].includes(job.status)
        ? job.status
        : 'waiting',
    };
  });

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      mode: allowedModes.has(settings.mode) ? settings.mode : 'Image',
      model: allowedModels.has(settings.model)
        ? settings.model
        : 'Nano Banana Pro',
      aspect: allowedAspects.has(settings.aspect)
        ? settings.aspect
        : '16:9',
      count: allowedCounts.has(settings.count) ? settings.count : '1x',
      submitDelayMs:
        Number.isFinite(submitDelayMs) &&
        submitDelayMs >= 800 &&
        submitDelayMs <= 15_000
          ? Math.round(submitDelayMs)
          : 2500,
    },
    jobs,
  };
}

function workspaceFile(workspaceId) {
  const id = String(workspaceId || '');
  if (!/^[a-z0-9-]{1,80}$/i.test(id)) {
    throw new Error('Invalid batch workspace id.');
  }
  return path.join(WORKSPACE_DIR, `${id}.json`);
}

async function writeBatchFile(workspaceId, batch) {
  const normalized = normalizeBatch(batch);
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  await fs.writeFile(
    workspaceFile(workspaceId),
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return normalized;
}

async function readLegacyBatch() {
  try {
    const parsed = JSON.parse(await fs.readFile(BATCH_PATH, 'utf8'));
    return normalizeBatch(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return defaultBatch();
  }
}

async function writeWorkspaceIndex(index) {
  const normalized = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    workspaces: index.workspaces.map((workspace) => ({
      id: String(workspace.id),
      title: cleanText(workspace.title, 80) || 'Batch',
      createdAt: workspace.createdAt || new Date().toISOString(),
      updatedAt: workspace.updatedAt || new Date().toISOString(),
      chromeProfileDir: workspace.chromeProfileDir || null,
      cdpPort: workspace.cdpPort || null,
      flowUrl: workspace.flowUrl || null,
      status: workspace.status || 'idle',
      lastActiveAt: workspace.lastActiveAt || new Date().toISOString(),
      archived: workspace.archived === true,
    })),
  };
  await fs.mkdir(path.dirname(WORKSPACE_INDEX_PATH), {
    recursive: true,
  });
  await fs.writeFile(
    WORKSPACE_INDEX_PATH,
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return normalized;
}

async function loadWorkspaceIndex() {
  try {
    const parsed = JSON.parse(
      await fs.readFile(WORKSPACE_INDEX_PATH, 'utf8'),
    );
    if (!Array.isArray(parsed.workspaces)) {
      throw new Error('Batch workspace index is invalid.');
    }
    return {
      schemaVersion: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      workspaces: parsed.workspaces
        .filter(
          (workspace) =>
            workspace &&
            /^[a-z0-9-]{1,80}$/i.test(String(workspace.id || '')),
        )
        .map((workspace) => ({
          id: String(workspace.id),
          title: cleanText(workspace.title, 80) || 'Batch',
          createdAt: workspace.createdAt || new Date().toISOString(),
          updatedAt: workspace.updatedAt || new Date().toISOString(),
          chromeProfileDir: workspace.chromeProfileDir || null,
          cdpPort: workspace.cdpPort || null,
          flowUrl: workspace.flowUrl || null,
          status: workspace.status || 'idle',
          lastActiveAt: workspace.lastActiveAt || new Date().toISOString(),
          archived: workspace.archived === true,
        })),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const now = new Date().toISOString();
    const first = {
      id: 'batch-1',
      title: 'Batch 1',
      createdAt: now,
      updatedAt: now,
      chromeProfileDir: null,
      cdpPort: null,
      flowUrl: null,
      status: 'idle',
      lastActiveAt: now,
    };
    await writeBatchFile(first.id, await readLegacyBatch());
    return writeWorkspaceIndex({
      schemaVersion: 1,
      workspaces: [first],
    });
  }
}

export async function listBatchWorkspaces() {
  const index = await loadWorkspaceIndex();
  const active = index.workspaces.filter((w) => !w.archived);
  if (active.length > 0) return active;
  const created = await createBatchWorkspace({ title: 'Batch 1' });
  return [created.workspace];
}

export async function createBatchWorkspace({
  title,
  batch = blankBatch(),
} = {}) {
  const index = await loadWorkspaceIndex();
  const used = new Set(index.workspaces.map((workspace) => workspace.id));
  let number = 1;
  while (used.has(`batch-${number}`)) number += 1;
  const now = new Date().toISOString();
  const workspace = {
    id: `batch-${number}`,
    title:
      cleanText(title, 80).trim() ||
      `Batch ${number}`,
    createdAt: now,
    updatedAt: now,
    chromeProfileDir: null,
    cdpPort: null,
    flowUrl: null,
    status: 'idle',
    lastActiveAt: now,
  };
  const normalized = await writeBatchFile(workspace.id, batch);
  index.workspaces.push(workspace);
  await writeWorkspaceIndex(index);
  return { workspace, batch: normalized };
}

export async function updateBatchWorkspace(workspaceId, patch) {
  const index = await loadWorkspaceIndex();
  const workspace = index.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error(`Batch workspace "${workspaceId}" does not exist.`);
  
  if (patch.title !== undefined) workspace.title = cleanText(patch.title, 80).trim() || workspace.title;
  if (patch.status !== undefined) workspace.status = patch.status;
  if (patch.chromeProfileDir !== undefined) workspace.chromeProfileDir = patch.chromeProfileDir;
  if (patch.cdpPort !== undefined) workspace.cdpPort = patch.cdpPort;
  if (patch.flowUrl !== undefined) workspace.flowUrl = patch.flowUrl;
  
  workspace.lastActiveAt = new Date().toISOString();
  workspace.updatedAt = new Date().toISOString();
  
  await writeWorkspaceIndex(index);
  return workspace;
}

export async function deleteBatchWorkspace(workspaceId) {
  const index = await loadWorkspaceIndex();
  const workspaceIndex = index.workspaces.findIndex((w) => w.id === workspaceId);
  if (workspaceIndex === -1) throw new Error(`Batch workspace "${workspaceId}" does not exist.`);
  
  const activeCount = index.workspaces.filter((w) => !w.archived).length;
  if (activeCount <= 1 && !index.workspaces[workspaceIndex].archived) {
    throw new Error('Cannot delete the last workspace.');
  }

  index.workspaces[workspaceIndex].archived = true;
  await writeWorkspaceIndex(index);

  return index.workspaces[workspaceIndex];
}

async function resolveWorkspaceId(workspaceId) {
  const workspaces = await listBatchWorkspaces();
  const id = workspaceId ? String(workspaceId) : workspaces[0].id;
  if (!workspaces.some((workspace) => workspace.id === id)) {
    throw new Error(`Batch workspace "${id}" does not exist.`);
  }
  return id;
}

export async function loadBatch(workspaceId) {
  const id = await resolveWorkspaceId(workspaceId);
  try {
    const parsed = JSON.parse(
      await fs.readFile(workspaceFile(id), 'utf8'),
    );
    return normalizeBatch(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return writeBatchFile(id, blankBatch());
  }
}

export async function saveBatch(batch, workspaceId) {
  const id = await resolveWorkspaceId(workspaceId);
  const normalized = await writeBatchFile(id, batch);
  const index = await loadWorkspaceIndex();
  const workspace = index.workspaces.find((item) => item.id === id);
  if (workspace) {
    workspace.updatedAt = normalized.updatedAt;
    await writeWorkspaceIndex(index);
  }
  return normalized;
}

export async function saveReference({
  workspaceId,
  jobId,
  slot,
  fileName,
  mimeType,
  dataBase64,
}) {
  const numericJobId = Number(jobId);
  const numericSlot = Number(slot);
  if (
    !Number.isInteger(numericJobId) ||
    !Number.isInteger(numericSlot) ||
    numericSlot < 0 ||
    numericSlot > 4
  ) {
    throw new Error('Invalid reference target.');
  }
  const extensions = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  };
  const extension = extensions[mimeType];
  if (!extension) {
    throw new Error('Reference must be PNG, JPEG, or WebP.');
  }
  const bytes = Buffer.from(String(dataBase64 || ''), 'base64');
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    throw new Error('Reference file must be between 1 byte and 8 MB.');
  }
  const safeStem = path
    .basename(fileName || 'reference', path.extname(fileName || ''))
    .replace(/[^a-z0-9_-]+/gi, '_')
    .slice(0, 50);
  const assetName = `${numericJobId}-${numericSlot}-${Date.now()}-${
    safeStem || 'reference'
  }${extension}`;
  await fs.mkdir(REFERENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(REFERENCE_DIR, assetName), bytes);

  const batch = await loadBatch(workspaceId);
  const job = batch.jobs.find((candidate) => candidate.id === numericJobId);
  if (!job) throw new Error(`Job ${numericJobId} no longer exists.`);
  job.references[numericSlot] = `/batch-assets/${assetName}`;
  await saveBatch(batch, workspaceId);
  return { url: job.references[numericSlot] };
}

export async function deleteReference({ workspaceId, jobId, slot }) {
  const numericJobId = Number(jobId);
  const numericSlot = Number(slot);
  if (
    !Number.isInteger(numericJobId) ||
    !Number.isInteger(numericSlot) ||
    numericSlot < 0 ||
    numericSlot > 4
  ) {
    throw new Error('Invalid reference target.');
  }
  const batch = await loadBatch(workspaceId);
  const job = batch.jobs.find((candidate) => candidate.id === numericJobId);
  if (!job) throw new Error(`Job ${numericJobId} no longer exists.`);
  const reference = job.references[numericSlot];
  job.references[numericSlot] = null;
  await saveBatch(batch, workspaceId);

  if (reference?.startsWith('/batch-assets/')) {
    const assetName = path.basename(reference);
    const filePath = path.resolve(REFERENCE_DIR, assetName);
    const relative = path.relative(REFERENCE_DIR, filePath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  return { deleted: Boolean(reference) };
}

export function referenceFilePath(referenceUrl) {
  if (
    typeof referenceUrl !== 'string' ||
    !referenceUrl.startsWith('/batch-assets/')
  ) {
    return null;
  }
  const filePath = path.resolve(REFERENCE_DIR, path.basename(referenceUrl));
  const relative = path.relative(REFERENCE_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return filePath;
}
