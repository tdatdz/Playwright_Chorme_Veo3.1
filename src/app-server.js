import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMaskedProviders,
  addOrUpdateProvider,
  deleteProvider,
  getProviderById,
  setDefaultProvider
} from './ai-provider-store.js';
import { getProviderCatalog } from './ai-provider-catalog.js';
import { adapters } from './ai-provider-adapters.js';
import { startOAuthFlow, handleOAuthCallback, getOAuthStatus, completeOAuthManual } from './ai-provider-oauth.js';
import { authenticate } from './auth.js';
import {
  createBatchWorkspace,
  deleteReference,
  listBatchWorkspaces,
  updateBatchWorkspace,
  loadBatch,
  REFERENCE_DIR,
  saveBatch,
  saveReference,
} from './batch-store.js';
import { connectToFlow, discoverCdpEndpoint } from './chrome.js';
import { runKeyframe } from './executor.js';
import { runFlowBatch } from './flow-batch-executor.js';
import {
  createFlowProjectTab,
  ensureFlowProject,
  flowProjectId,
  listFlowProjectPages,
} from './flow-project.js';
import { resolveOutputAsset } from './output-store.js';
import { installRecorder } from './recorder.js';
import { loadRegistry, resetRegistry } from './registry.js';
import {
  buildDirectorInstruction,
  compileMasterPrompt,
  validateMasterPrompt,
} from './script-director.js';
import {
  loadScriptStudio,
  saveScriptStudio,
} from './script-studio-store.js';

const PORT = Number(process.env.FLOW_APP_PORT || 3210);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RECIPE_DIR = path.join(ROOT, 'artifacts', 'recipes');
const clients = new Set();
const logHistory = [];

const workspaceStates = new Map();

function getWorkspaceState(workspaceId) {
  if (!workspaceStates.has(workspaceId)) {
    workspaceStates.set(workspaceId, {
      connection: null,
      operation: null,
      activeFlowProjectId: null,
      recorder: null,
      recorderName: null,
      chromeProcess: null,
    });
  }
  return workspaceStates.get(workspaceId);
}

function getFreePort(startPort, endPort) {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    const testPort = () => {
      if (currentPort > endPort) return reject(new Error('No free ports available.'));
      const server = http.createServer();
      server.listen(currentPort, '127.0.0.1', () => {
        server.close(() => resolve(currentPort));
      });
      server.on('error', () => {
        currentPort++;
        testPort();
      });
    };
    testPort();
  });
}

async function allocateWorkspaceChrome(workspaceId) {
  const workspaces = await listBatchWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

  let port = ws.cdpPort;
  let profileDir = ws.chromeProfileDir;
  let updated = false;

  if (!port) {
    port = await getFreePort(9222, 9300);
    updated = true;
  }
  
  if (!profileDir) {
    const safeId = workspaceId.replace(/[^a-zA-Z0-9-]/g, '');
    profileDir = `.chrome-profiles/workspace-${safeId}`;
    updated = true;
  }

  if (updated) {
    await updateBatchWorkspace(workspaceId, { cdpPort: port, chromeProfileDir: profileDir });
  }

  return { port, profileDir };
}

function log(level, message, data = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    message,
    data,
  };
  logHistory.push(event);
  if (logHistory.length > 500) logHistory.shift();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
  const prefix = (!data || !data.workspaceId) ? '[GLOBAL]' : `[WS-${data.workspaceId.slice(0,4)}]`;
  const prefixedMsg = message.startsWith('[') ? message : `${prefix} ${message}`;
  console.log(`[${level}] ${prefixedMsg}`);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 1_000_000) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error('Request body is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function recipes() {
  try {
    const files = await fs.readdir(RECIPE_DIR);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function recipeSummaries(names, registry) {
  return Promise.all(
    names.map(async (name) => {
      try {
        const recipe = JSON.parse(
          await fs.readFile(path.join(RECIPE_DIR, `${name}.json`), 'utf8'),
        );
        const controls = [
          ...new Set(
            recipe.steps
              .map((step) => step.control)
              .filter(Boolean),
          ),
        ];
        return {
          name,
          steps: recipe.steps.length,
          missingControls: controls.filter(
            (control) => !registry.controls[control],
          ).length,
          riskySteps: recipe.steps.filter((step) => step.risk).length,
        };
      } catch {
        return {
          name,
          steps: 0,
          missingControls: -1,
          riskySteps: 0,
        };
      }
    }),
  );
}

async function chromeStatus(workspaceId) {
  try {
    let endpoint;
    if (workspaceId) {
      const workspaces = await listBatchWorkspaces();
      const ws = workspaces.find((w) => w.id === workspaceId);
      endpoint = await discoverCdpEndpoint(ws?.cdpPort || null);
    } else {
      endpoint = await discoverCdpEndpoint();
    }
    const response = await fetch(`${endpoint}/json/list`);
    const tabs = await response.json();
    return {
      connected: true,
      endpoint,
      flowOpen: tabs.some((tab) =>
        String(tab.url).includes('labs.google/fx/vi/tools/flow'),
      ),
      tabCount: tabs.length,
    };
  } catch {
    return {
      connected: false,
      endpoint: null,
      flowOpen: false,
      tabCount: 0,
    };
  }
}

async function getConnection(workspaceId) {
  const st = getWorkspaceState(workspaceId);
  if (
    st.connection?.page &&
    !st.connection.page.isClosed()
  ) {
    return st.connection;
  }
  let port = null;
  if (workspaceId) {
    const workspaces = await listBatchWorkspaces();
    const ws = workspaces.find((w) => w.id === workspaceId);
    port = ws?.cdpPort || null;
  }
  st.connection = await connectToFlow({ port });
  return st.connection;
}

function assertIdle(workspaceId) {
  const st = getWorkspaceState(workspaceId);
  if (st.operation) {
    throw new Error(`workspace đang chạy`);
  }
  if (st.recorder) {
    throw new Error(`Recorder "${st.recorderName}" is active.`);
  }
}

function startChrome(port, profileDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(ROOT, 'scripts', 'start-chrome.ps1'),
    ];
    if (port) args.push('-port', String(port));
    if (profileDir) args.push('-profileDir', String(profileDir));

    const child = spawn('powershell', args, {
      cwd: ROOT,
      windowsHide: true,
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput.trim() || `Chrome exited with ${code}.`));
        return;
      }
      resolve(output.trim());
    });
  });
}

function flowEvent(event) {
  log(event.level, event.message, event);
}

async function ensureChromeConnection(workspaceId) {
  const { port, profileDir } = await allocateWorkspaceChrome(workspaceId);
  const chrome = await chromeStatus(workspaceId);
  if (!chrome.connected || !chrome.flowOpen) {
    log(
      'INFO',
      chrome.connected
        ? 'Chrome đang mở nhưng thiếu tab Flow; đang mở lại Flow.'
        : 'Chrome chưa mở; đang khởi động profile Flow.',
      { workspaceId }
    );
    await startChrome(port, profileDir);
    log('INFO', 'Starting dedicated Chrome', { workspaceId });
    log('INFO', `profileDir=${profileDir}`, { workspaceId });
    log('INFO', `cdpPort=${port}`, { workspaceId });
    const st = getWorkspaceState(workspaceId);
    st.connection = null;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await chromeStatus(workspaceId);
      if (status.flowOpen) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Chrome opened but Flow tab is not ready.');
    
    const { page } = await getConnection(workspaceId);
    try {
      await authenticate(page);
    } catch (e) {
      log('WARNING', `Could not import cookies: ${e.message}`, { workspaceId });
    }
  }
  return getConnection(workspaceId);
}

async function runBatchWithLogging({
  page,
  batch,
  workspaceId,
  selectedIds,
  dryRun,
}) {
  return runFlowBatch({
    page,
    batch,
    workspaceId,
    selectedIds,
    dryRun,
    onEvent: async (event) => {
      log(event.level, event.message, {
        jobId: event.jobId || null,
        workspaceId,
      });
    },
    onJobUpdate: async (job, patch) => {
      Object.assign(job, patch);
      if (patch.status === 'done') job.selected = false;
      await saveBatch(batch, workspaceId);
      const status = job.status;
      let progress = job.progress || 0;
      let progressStr = '';
      if (typeof progress === 'number' || (!isNaN(Number(progress)) && progress !== '')) {
        progress = Number(progress);
        progressStr = ` ${progress}%`;
      } else {
        progressStr = ` (${progress})`;
      }
      log(
        status === 'error' ? 'ERROR' : 'INFO',
        `[${job.code}] trạng thái → ${status.toUpperCase()}${
          status === 'running' ? progressStr : ''
        }`,
        {
          jobId: job.id,
          status,
          progress,
          result: job.result || null,
          results: job.results || [],
          runFolder: job.runFolder || null,
          selected: job.selected,
          workspaceId,
        },
      );
    },
  });
}

function executorLog(event) {
  const prefix =
    Number.isInteger(event.index) ? `B${event.index + 1}` : 'RUN';
  if (event.type === 'resolve') {
    log('INFO', `${prefix} tìm control: ${event.control}`);
  } else if (event.type === 'observe') {
    log(
      'OBSERVE',
      `${prefix} UI ổn định · ${event.role} "${event.target}" · ${event.mutations} mutation`,
      { control: event.control },
    );
  } else if (event.type === 'action') {
    log(
      'ACTION',
      `${prefix} ${event.action.toUpperCase()} → ${event.control}`,
      { risk: event.risk || null },
    );
  } else if (event.type === 'guard') {
    log('GUARD', `${prefix} ${event.message}`, {
      control: event.control,
    });
  } else if (event.type === 'success') {
    log('SUCCESS', `${prefix} hoàn tất: ${event.control}`);
  } else if (event.type === 'error') {
    log('ERROR', `${prefix} ${event.message}`, {
      control: event.control,
    });
  } else if (event.type === 'wait') {
    log('WAIT', `${prefix} chờ ${event.milliseconds} ms`);
  } else if (event.type === 'start') {
    log(
      'INFO',
      `Bắt đầu recipe ${event.recipe}: ${event.totalSteps} bước.`,
    );
  }
}

async function api(request, response, pathname) {
  const requestUrl = new URL(
    request.url,
    `http://${request.headers.host || '127.0.0.1'}`,
  );
  if (
    request.method === 'POST' &&
    request.headers['x-flow-observer'] !== '1'
  ) {
    sendJson(response, 403, {
      error: 'Missing Flow Observer request token.',
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/status') {
    const workspaceId = requestUrl.searchParams.get('workspaceId');
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    const [chrome, registry, recipeNames] = await Promise.all([
      chromeStatus(workspaceId),
      loadRegistry(),
      recipes(),
    ]);
    const summaries = await recipeSummaries(recipeNames, registry);
    const st = getWorkspaceState(workspaceId);
    sendJson(response, 200, {
      chrome,
      recipes: summaries,
      registryCount: Object.keys(registry.controls).length,
      recorder: st.recorderName,
      operation: st.operation,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/batch') {
    sendJson(
      response,
      200,
      await loadBatch(requestUrl.searchParams.get('workspaceId')),
    );
    return;
  }

  if (
    request.method === 'GET' &&
    pathname === '/api/batch/workspaces'
  ) {
    sendJson(response, 200, {
      workspaces: await listBatchWorkspaces(),
    });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/batch/workspaces/new'
  ) {
    const body = await readJson(request, 5_000_000);
    const result = await createBatchWorkspace({
      title: body.title,
      batch: body.batch,
    });
    log(
      'SUCCESS',
      `Đã tạo cửa sổ Timeline "${result.workspace.title}".`,
      {
        refreshWorkspaces: true,
        workspaceId: result.workspace.id,
      },
    );
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/script-studio') {
    sendJson(response, 200, await loadScriptStudio());
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/script-studio/save'
  ) {
    const studio = await saveScriptStudio(
      await readJson(request, 2_000_000),
    );
    sendJson(response, 200, { ok: true, studio });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/script-studio/compile'
  ) {
    const studio = await saveScriptStudio(
      await readJson(request, 2_000_000),
    );
    const master = compileMasterPrompt(studio);
    studio.masterJson = JSON.stringify(master, null, 2);
    await saveScriptStudio(studio);
    log(
      'SUCCESS',
      `Director compiler đã chia ${master.scenes.length} scene · ${master.project.totalDuration}s.`,
    );
    sendJson(response, 200, {
      ok: true,
      master,
      directorInstruction: buildDirectorInstruction(studio),
    });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/script-studio/instruction'
  ) {
    const studio = await saveScriptStudio(
      await readJson(request, 2_000_000),
    );
    sendJson(response, 200, {
      ok: true,
      instruction: buildDirectorInstruction(studio),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/flow/sessions') {
    const workspaceId = requestUrl.searchParams.get('workspaceId');
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    const chrome = await chromeStatus(workspaceId);
    if (!chrome.connected) {
      sendJson(response, 200, { sessions: [], active: null });
      return;
    }
    const st = getWorkspaceState(workspaceId);
    let port = null;
    const workspaces = await listBatchWorkspaces();
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (ws) port = ws.cdpPort || null;
    const connection =
      st.connection?.browser && st.connection.browser.isConnected()
        ? st.connection
        : await connectToFlow({ port, requireFlowPage: false });
    st.connection = connection;
    const sessions = listFlowProjectPages(connection.browser).map(
      (page, index) => {
        const id = flowProjectId(page);
        return {
          id,
          label: `Flow ${index + 1}`,
          url: page.url(),
          active: id === st.activeFlowProjectId,
        };
      },
    );
    sendJson(response, 200, {
      sessions,
      active: st.activeFlowProjectId,
    });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/flow/session/new'
  ) {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const st = getWorkspaceState(workspaceId);
    st.operation = 'new-flow-project';
    try {
      const connection = await ensureChromeConnection(workspaceId);
      const page = await createFlowProjectTab(connection.browser, {
        onEvent: flowEvent,
      });
      const id = flowProjectId(page);
      st.connection.page = page;
      st.activeFlowProjectId = id;
      log('SUCCESS', `Đã tạo tab/project Flow mới: ${id}`, {
        refreshSessions: true, workspaceId
      });
      sendJson(response, 200, {
        ok: true,
        session: {
          id,
          label: `Flow ${listFlowProjectPages(connection.browser).length}`,
          url: page.url(),
          active: true,
        },
      });
    } finally {
      st.operation = null;
    }
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/flow/session/activate'
  ) {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    const connection = await ensureChromeConnection(workspaceId);
    const page = listFlowProjectPages(connection.browser).find(
      (candidate) => flowProjectId(candidate) === String(body.sessionId),
    );
    if (!page) throw new Error('Flow session không còn tồn tại.');
    await page.bringToFront();
    const st = getWorkspaceState(workspaceId);
    st.connection.page = page;
    st.activeFlowProjectId = flowProjectId(page);
    log('INFO', 'Đã chuyển đổi Flow session.', { refreshSessions: true, workspaceId });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/script-studio/run-flow'
  ) {
    assertIdle();
    const body = await readJson(request, 5_000_000);
    const commit = Boolean(body.commit);
    if (!commit) {
      throw new Error(
        'Run Flow cần commit=true sau khi người dùng xác nhận sử dụng lượt tạo.',
      );
    }
    const master = validateMasterPrompt(body.masterJson);
    const flattened = master.scenes.flatMap((scene) =>
      scene.prompts.map((prompt, promptIndex) => ({
        scene: scene.scene,
        promptIndex,
        prompt,
      })),
    );
    if (flattened.length > 300) {
      throw new Error('Master JSON vượt quá giới hạn 300 prompt mỗi lần Run.');
    }
    const currentBatch = await loadBatch(body.workspaceId || body.sourceWorkspaceId);
    const workspaceResult = await createBatchWorkspace({
      title: `Master ${new Date()
        .toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour12: false,
        })
        .replace(',', '')}`,
      batch: {
      schemaVersion: 1,
      settings: {
        ...currentBatch.settings,
        ...(body.settings || {}),
        mode: 'Image',
      },
      jobs: flattened.map((item, index) => ({
        id: index + 1,
        code: `S${item.scene}.${item.promptIndex + 1}`,
        selected: true,
        prompt: item.prompt,
        references: [null, null, null, null, null],
        result: null,
        results: [],
        progress: 0,
        runFolder: null,
        status: 'waiting',
      })),
      },
    });
    const { workspace, batch } = workspaceResult;
    const selectedIds = new Set(batch.jobs.map((job) => job.id));
    log(
      'SUCCESS',
      `Đã nạp ${batch.jobs.length} prompt từ ${master.scenes.length} scene vào Timeline.`,
      {
        refreshBatch: true,
        refreshWorkspaces: true,
        workspaceId: workspace.id,
      },
    );

    const st = getWorkspaceState(workspace.id);
    st.operation = 'master-flow-run';
    try {
      const connection = await ensureChromeConnection(workspace.id);
      const page = await ensureFlowProject(connection.page, {
        onEvent: flowEvent,
        createIfMissing: true,
      });
      st.connection.page = page;
      st.activeFlowProjectId = flowProjectId(page);
      log(
        'INFO',
        `Bắt đầu Master Flow Run tại project ${st.activeFlowProjectId}.`,
        { workspaceId: workspace.id },
      );
      const results = await runBatchWithLogging({
        page,
        batch,
        workspaceId: workspace.id,
        selectedIds,
        dryRun: false,
      });
      sendJson(response, 200, {
        ok: true,
        workspaceId: workspace.id,
        projectId: st.activeFlowProjectId,
        results,
      });
    } finally {
      st.operation = null;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/batch/save') {
    const body = await readJson(request, 5_000_000);
    const batch = await saveBatch(body.batch, body.workspaceId);
    sendJson(response, 200, {
      ok: true,
      updatedAt: batch.updatedAt,
      jobs: batch.jobs.length,
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/batch/reference') {
    const result = await saveReference(
      await readJson(request, 12_000_000),
    );
    log('SUCCESS', `Đã lưu reference local: ${result.url}`);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/batch/reference/delete'
  ) {
    const result = await deleteReference(await readJson(request));
    log(
      'GUARD',
      result.deleted
        ? 'Đã xóa reference khỏi job và ổ đĩa local.'
        : 'Reference đã trống.',
    );
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/batch/validate') {
    const body = await readJson(request);
    const commit = Boolean(body.commit);
    const batch = await loadBatch(body.workspaceId);
    const selectedIds = new Set(
      (Array.isArray(body.selectedIds) ? body.selectedIds : []).map(Number),
    );
    const selected = batch.jobs.filter((job) => selectedIds.has(job.id));
    const issues = [];

    if (selected.length === 0) {
      issues.push('Không có job nào được chọn.');
    }
    if (batch.settings.mode !== 'Image') {
      issues.push(
        'Direct adapter hiện chỉ hỗ trợ Image; Video cần state machine riêng.',
      );
    }
    if (
      !['Nano Banana Pro', 'Nano Banana 2'].includes(
        batch.settings.model,
      )
    ) {
      issues.push(
        `Model "${batch.settings.model}" không hợp lệ cho Image mode.`,
      );
    }
    for (const job of selected) {
      if (!job.prompt.trim()) {
        issues.push(`${job.code}: prompt đang trống.`);
      }
      if (
        commit &&
        ['running', 'done'].includes(job.status)
      ) {
        issues.push(
          `${job.code}: trạng thái ${job.status}; bấm ↻ để xác nhận chạy lại và tránh gửi trùng.`,
        );
      }
      if (
        batch.settings.mode === 'Frames to Video' &&
        !job.references.some(Boolean)
      ) {
        issues.push(`${job.code}: thiếu start-frame reference.`);
      }
    }

    const ready = issues.length === 0;
    if (ready) {
      log(
        'SUCCESS',
        `Batch preflight đạt: ${selected.length} job · ${batch.settings.model} · ${batch.settings.aspect} · ${batch.settings.count}.`,
      );
    } else {
      log(
        'GUARD',
        `Batch preflight chặn: ${issues.join(' | ')}`,
      );
    }
    sendJson(response, 200, {
      ready,
      selected: selected.length,
      issues,
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/batch/run') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const selectedIds = new Set(
      (Array.isArray(body.selectedIds) ? body.selectedIds : []).map(Number),
    );
    const commit = Boolean(body.commit);
    const batch = await loadBatch(workspaceId);
    const st = getWorkspaceState(workspaceId);
    st.operation = commit ? 'batch-run' : 'batch-dry-run';
    try {
      const connection = await ensureChromeConnection(workspaceId);
      const page = await ensureFlowProject(connection.page, {
        onEvent: flowEvent,
        createIfMissing: true,
      });
      st.connection.page = page;
      st.activeFlowProjectId = flowProjectId(page);
      log(
        'INFO',
        commit
          ? `Bắt đầu batch Run thật cho ${selectedIds.size} job.`
          : `Bắt đầu batch dry-run cho ${selectedIds.size} job.`,
        { workspaceId }
      );
      const results = await runBatchWithLogging({
        page,
        batch,
        workspaceId,
        selectedIds,
        dryRun: !commit,
      });
      sendJson(response, 200, { ok: true, commit, results });
    } finally {
      st.operation = null;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/chrome/start') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    log('INFO', 'Yêu cầu mở Chrome automation.', { workspaceId });
    await ensureChromeConnection(workspaceId);
    log('SUCCESS', 'Chrome automation đã mở.', { workspaceId });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const st = getWorkspaceState(workspaceId);
    st.operation = 'auth';
    try {
      log('INFO', 'Đang nhập cookie vào profile Flow.', { workspaceId });
      const { page } = await getConnection(workspaceId);
      const result = await authenticate(page);
      if (result.mode === 'manual') {
        log('GUARD', 'Không có cookie hợp lệ; cần đăng nhập thủ công.', { workspaceId });
      } else {
        log(
          'SUCCESS',
          `Đã nhập ${result.imported} cookie và reload Flow.`,
          { workspaceId }
        );
      }
      sendJson(response, 200, { ok: true, mode: result.mode });
    } finally {
      st.operation = null;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/record/start') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const name = String(body.name || '').trim();
    if (!name) throw new Error('Hãy nhập tên recipe.');
    const { page } = await getConnection(workspaceId);
    const st = getWorkspaceState(workspaceId);
    st.recorder = await installRecorder(page, name, (event) => {
      log(
        event.level,
        `Ghi nhận thao tác: ${
          event.action === 'click'
            ? 'CLICK'
            : `${event.action.toUpperCase()} '${event.value}'`
        }`,
        { control: event.control, workspaceId },
      );
    });
    st.recorderName = name;
    log('RECORD', `Bắt đầu ghi recipe "${name}".`, { workspaceId });
    sendJson(response, 200, { ok: true, name });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/record/stop') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    const st = getWorkspaceState(workspaceId);
    if (!st.recorder) throw new Error('Recorder chưa chạy.');
    const recorder = st.recorder;
    const name = st.recorderName;
    st.recorder = null;
    st.recorderName = null;
    const recipe = await recorder.stop();
    await fs.mkdir(RECIPE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(RECIPE_DIR, `${name}.json`),
      JSON.stringify(recipe, null, 2),
    );
    log(
      'SUCCESS',
      `Đã lưu recipe "${name}" với ${recipe.steps.length} bước.`,
      { workspaceId }
    );
    sendJson(response, 200, { ok: true, name });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/replay') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const name = String(body.name || '').trim();
    if (!name) throw new Error('Cần cung cấp tên recipe.');
    const recipePath = path.join(RECIPE_DIR, `${name}.json`);
    const st = getWorkspaceState(workspaceId);
    st.operation = `replay:${name}`;
    try {
      const parsed = JSON.parse(await fs.readFile(recipePath, 'utf8'));
      log(
        'INFO',
        `Bắt đầu Replay recipe "${name}" (${parsed.steps.length} bước).`,
        { workspaceId }
      );
      const { page } = await getConnection(workspaceId);
      const results = await runKeyframe(page, recipePath, {
        allowRepeatSideEffects: Boolean(body.forceRepeat),
        onEvent: (event) => {
          const prefix = Number.isInteger(event.index) ? `B${event.index + 1}` : 'RUN';
          if (event.type === 'resolve') {
            log('INFO', `${prefix} tìm control: ${event.control}`, { workspaceId });
          } else if (event.type === 'observe') {
            log('OBSERVE', `${prefix} UI ổn định · ${event.role} "${event.target}" · ${event.mutations} mutation`, { control: event.control, workspaceId });
          } else if (event.type === 'action') {
            log('ACTION', `${prefix} ${event.action.toUpperCase()} → ${event.control}`, { risk: event.risk || null, workspaceId });
          } else if (event.type === 'guard') {
            log('GUARD', `${prefix} ${event.message}`, { control: event.control, workspaceId });
          } else if (event.type === 'success') {
            log('SUCCESS', `${prefix} hoàn tất: ${event.control}`, { workspaceId });
          } else if (event.type === 'error') {
            log('ERROR', `${prefix} ${event.message}`, { control: event.control, workspaceId });
          } else if (event.type === 'wait') {
            log('WAIT', `${prefix} chờ ${event.milliseconds} ms`, { workspaceId });
          } else if (event.type === 'start') {
            log('INFO', `Bắt đầu recipe ${event.recipe}: ${event.totalSteps} bước.`, { workspaceId });
          }
        },
      });
      log(
        'SUCCESS',
        `Recipe "${name}" hoàn tất ${results.length} bước.`,
        { workspaceId }
      );
      sendJson(response, 200, { ok: true, results });
    } finally {
      st.operation = null;
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/registry/reset') {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const result = await resetRegistry();
    log(
      'SUCCESS',
      `Đã dọn dẹp flow-ui-registry. Xóa ${
        result.removedControls
      } control.`,
      { workspaceId }
    );
    sendJson(response, 200, result);
    return;
  }

  
  if (request.method === 'POST' && pathname === '/api/ai/oauth/start') {
    try {
      let body = await readJson(request);
      if (body.mode === 'preset') {
         const catalog = await getProviderCatalog();
         let item = null;
         for (const cat of Object.values(catalog.categories)) {
           item = cat.find(x => x.id === body.catalogId);
           if (item) break;
         }
         if (!item) throw new Error('Preset not found');
         body = {
            ...body,
            catalogId: item.id,
            connectionName: item.label,
            clientId: item.clientId,
            clientSecret: item.clientSecret || '',
            authorizationUrl: item.authorizationUrl,
            tokenUrl: item.tokenUrl,
            scopes: item.scopes,
            extraAuthorizeParams: item.extraAuthorizeParams,
            callbackMode: item.defaultRedirectUri && item.defaultRedirectUri.includes('1455') ? 'local_1455' : 'app',
            adapter: item.adapter,
            family: item.family
         };
      }
      
      const origin = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;
      const redirectUri = `${origin}/api/ai/oauth/callback`;
      body.redirectUri = redirectUri;
      
      const authUrl = startOAuthFlow(body);
      
      const parsed = new URL(authUrl);
      const state = parsed.searchParams.get('state');
      const rUri = parsed.searchParams.get('redirect_uri');
      
      sendJson(response, 200, { ok: true, authorizationUrl: authUrl, state, redirectUri: rUri, callbackMode: body.callbackMode });
    } catch (e) {
      console.error('OAuth start error:', e);
      sendJson(response, 500, { error: e.message });
    }
    return;
  }
  
  if (request.method === 'GET' && pathname === '/api/ai/oauth/status') {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const state = url.searchParams.get('state');
    const statusObj = getOAuthStatus(state);
    sendJson(response, 200, statusObj);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/oauth/complete-manual') {
    try {
      const body = await readJson(request);
      const saved = await completeOAuthManual(body.callbackUrl);
      sendJson(response, 200, { ok: true, id: saved.id });
    } catch(e) {
      sendJson(response, 400, { error: e.message });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/ai/oauth/callback') {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      
      if (!code || !state) {
        response.writeHead(302, { Location: '/?ai_oauth=error&reason=Missing+code+or+state' });
        response.end();
        return;
      }
      
      const origin = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;
      const redirectUri = `${origin}/api/ai/oauth/callback`;
      
      await handleOAuthCallback(code, state, redirectUri);
      
      response.writeHead(302, { Location: '/?ai_oauth=success' });
      response.end();
    } catch (e) {
      console.error('OAuth callback error:', e);
      response.writeHead(302, { Location: `/?ai_oauth=error&reason=${encodeURIComponent(e.message)}` });
      response.end();
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/oauth/disconnect') {
    try {
      const body = await readJson(request);
      if (body.providerId) {
         await deleteProvider(body.providerId);
      }
      sendJson(response, 200, { ok: true });
    } catch(e) {
      sendJson(response, 500, { error: e.message });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/ai/catalog') {
    try {
      const catalog = await getProviderCatalog();
      sendJson(response, 200, catalog);
    } catch (e) {
      console.error('[ai-provider] load catalog failed', e);
      sendJson(response, 500, { error: 'Failed to load catalog', details: e.message });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/ai/providers') {
    const data = await getMaskedProviders();
    sendJson(response, 200, data);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/providers') {
    const body = await readJson(request);
    const saved = await addOrUpdateProvider(body);
    sendJson(response, 200, saved);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/providers/default') {
    const body = await readJson(request);
    if (body.providerId) {
      await setDefaultProvider(body.providerId);
      sendJson(response, 200, { success: true });
    } else {
      sendJson(response, 400, { error: 'Missing providerId' });
    }
    return;
  }

  if (request.method === 'POST' && pathname.startsWith('/api/ai/providers/') && pathname.endsWith('/model')) {
    try {
      const parts = pathname.split('/');
      const id = parts[parts.length - 2];
      const { defaultModel, baseUrl } = await readJson(request);
      const saved = await addOrUpdateProvider({ id, defaultModel, baseUrl });
      sendJson(response, 200, { ok: true, id: saved.id });
    } catch(e) {
      sendJson(response, 500, { error: e.message });
    }
    return;
  }

  if (request.method === 'DELETE' && pathname.startsWith('/api/ai/providers/')) {
    const id = pathname.substring('/api/ai/providers/'.length);
    await deleteProvider(id);
    sendJson(response, 200, { success: true });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/test') {
    const body = await readJson(request);
    let targetProvider = body;
    
    if (body.providerId) {
      const stored = await getProviderById(body.providerId);
      if (!stored) {
        sendJson(response, 404, { error: 'Provider not found' });
        return;
      }
      targetProvider = stored;
    }
    
    let baseUrl = String(targetProvider.baseUrl || '').trim();
    if (!baseUrl) {
      sendJson(response, 400, { error: 'Base URL không được để trống.' });
      return;
    }
    if (baseUrl.endsWith('/')) targetProvider.baseUrl = baseUrl.slice(0, -1);
    
    const adapterName = targetProvider.adapter || 'openai-compatible';
    const adapter = adapters[adapterName];
    if (!adapter) {
      sendJson(response, 400, { error: 'Unsupported adapter: ' + adapterName });
      return;
    }
    
    try {
      const result = await adapter.testModels(targetProvider);
      if (body.providerId) await addOrUpdateProvider({ id: targetProvider.id, lastTestStatus: 'connected', lastTestedAt: new Date().toISOString() });
      sendJson(response, 200, result);
    } catch (error) {
      if (body.providerId) await addOrUpdateProvider({ id: targetProvider.id, lastTestStatus: 'error', lastTestedAt: new Date().toISOString() });
      sendJson(response, 500, { error: error.message || 'Unknown error' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/ai/generate') {
    const body = await readJson(request);
    const provider = await getProviderById(body.providerId);
    if (!provider) {
      sendJson(response, 404, { error: 'Không tìm thấy cấu hình Provider này.' });
      return;
    }
    
    let baseUrl = String(provider.baseUrl || '').trim();
    if (baseUrl.endsWith('/')) provider.baseUrl = baseUrl.slice(0, -1);
    
    const adapterName = provider.adapter || 'openai-compatible';
    const adapter = adapters[adapterName];
    if (!adapter) {
      sendJson(response, 400, { error: 'Unsupported adapter: ' + adapterName });
      return;
    }
    
    try {
      const result = await adapter.generate(provider, body);
      sendJson(response, 200, { result: result.text, usage: result.usage });
    } catch (error) {
      sendJson(response, 500, { error: error.message || 'Unknown error' });
    }
    return;
  }

  sendJson(response, 404, { error: 'API route not found.' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type':
        mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'File not found.' });
      return;
    }
    throw error;
  }
}

async function serveBatchAsset(response, pathname) {
  const assetName = decodeURIComponent(
    pathname.replace('/batch-assets/', ''),
  );
  const filePath = path.resolve(REFERENCE_DIR, assetName);
  const relative = path.relative(REFERENCE_DIR, filePath);
  if (
    !assetName ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    sendJson(response, 403, { error: 'Forbidden asset path.' });
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type':
        mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Asset not found.' });
      return;
    }
    throw error;
  }
}

async function serveOutputAsset(response, pathname) {
  const filePath = resolveOutputAsset(pathname);
  if (!filePath) {
    sendJson(response, 403, { error: 'Forbidden output path.' });
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type':
        mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Output not found.' });
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const event of logHistory) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await api(request, response, url.pathname);
      return;
    }
    if (url.pathname.startsWith('/batch-assets/')) {
      await serveBatchAsset(response, url.pathname);
      return;
    }
    if (url.pathname.startsWith('/output-assets/')) {
      await serveOutputAsset(response, url.pathname);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    log('ERROR', error.message);
    if (!response.headersSent) {
      sendJson(response, 400, { error: error.message });
    } else {
      response.end();
    }
  }
});

const heartbeat = setInterval(() => {
  for (const client of clients) client.write(': heartbeat\n\n');
}, 20_000);
heartbeat.unref();

server.listen(PORT, '127.0.0.1', () => {
  log('INFO', `Flow Observer Console chạy tại http://127.0.0.1:${PORT}`);
});
