import {
  assertNoUnexpectedUi,
  observeBeforeAction,
} from './safety.js';
import {
  clearActionIndicator,
  showActionIndicator,
} from './indicator.js';
import { referenceFilePath } from './batch-store.js';
import {
  createOutputRun,
  manifestJob,
  saveOutputMedia,
  saveRunManifest,
} from './output-store.js';

const ASPECT_ICON = {
  '16:9': 'crop_16_9',
  '4:3': 'crop_landscape',
  '1:1': 'crop_square',
  '3:4': 'crop_portrait',
  '9:16': 'crop_9_16',
};

function countLabel(value) {
  if (value === '1x') return '1x';
  return `x${value.replace('x', '')}`;
}

function expectedOutputCount(value) {
  const count = Number(String(value).replace('x', ''));
  return Number.isInteger(count) && count > 0 ? count : 1;
}

async function visibleUnique(locator, label, { timeoutMs = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const count = await locator.count();
    const visible = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        visible.push(candidate);
      }
    }
    if (visible.length === 1) return visible[0];
    if (Date.now() >= deadline) {
      throw new Error(
        `${label}: expected one visible control, found ${visible.length}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (true);
}

async function composerFor(page) {
  const textbox = page.getByRole('textbox').first();
  const composer = textbox.locator('..').locator('..');
  return { textbox, composer };
}

async function anyVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function mediaTiles(page) {
  const rawTiles = await page
    .locator('[data-tile-id]')
    .evaluateAll((elements) =>
      elements.map((element) => {
      const image = element.querySelector(
        'img[src*="media.getMediaUrlRedirect"]',
      );
      const video = element.querySelector('video[src]');
      const text = (element.innerText || element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const progressMatch = text.match(/(\d{1,3})\s*%/);
      return {
        id: element.getAttribute('data-tile-id'),
        text: text.slice(0, 300),
        progress: progressMatch
          ? Math.min(100, Number(progressMatch[1]))
          : image || video
            ? 100
            : 0,
        mediaUrl: image?.src || video?.src || null,
        mediaType: image ? 'image' : video ? 'video' : null,
      };
      }),
    );
  const uniqueTiles = new Map();
  for (const tile of rawTiles) {
    if (!tile.id) continue;
    const current = uniqueTiles.get(tile.id);
    if (
      !current ||
      (!current.mediaUrl && tile.mediaUrl) ||
      tile.text.length > current.text.length
    ) {
      uniqueTiles.set(tile.id, tile);
    }
  }
  return [...uniqueTiles.values()];
}

async function observedClick(
  page,
  locator,
  control,
  emit,
  { checkDialogs = true } = {},
) {
  const observation = await observeBeforeAction(locator);
  await emit('OBSERVE', `UI ổn định tại ${control}`, {
    mutations: observation.mutationCount,
  });
  await assertNoUnexpectedUi(page, locator, { checkDialogs });
  await showActionIndicator(page, locator, {
    action: 'click',
    control,
    previewMs: 450,
  });
  await emit('ACTION', `Click ${control}`);
  try {
    await locator.click();
  } finally {
    await clearActionIndicator(page);
  }
}

async function observedFill(page, locator, value, control, emit) {
  const observation = await observeBeforeAction(locator);
  await emit('OBSERVE', `UI ổn định tại ${control}`, {
    mutations: observation.mutationCount,
  });
  await assertNoUnexpectedUi(page, locator);
  await showActionIndicator(page, locator, {
    action: 'fill',
    control,
    previewMs: 450,
  });
  await emit('ACTION', `Điền ${control}`);
  try {
    await locator.fill(value);
  } finally {
    await clearActionIndicator(page);
  }
}

async function chooseTab(page, text, control, emit) {
  const tab = await visibleUnique(
    page.getByRole('tab').filter({ hasText: text }),
    control,
  );
  if ((await tab.getAttribute('aria-selected')) === 'true') {
    await emit('GUARD', `${control} đã được chọn, bỏ qua.`);
    return;
  }
  await observedClick(page, tab, control, emit);
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    throw new Error(`${control} did not become selected.`);
  }
}

async function configureFlow(page, settings, emit) {
  const { composer } = await composerFor(page);
  const configButton = await visibleUnique(
    composer.locator('button[aria-haspopup="menu"]'),
    'Flow configuration',
  );
  const aspectProbe = page
    .getByRole('tab')
    .filter({ hasText: '16:9' });
  const configOpen = await anyVisible(aspectProbe);
  if (!configOpen) {
    await observedClick(page, configButton, 'mở bảng cấu hình', emit);
  } else {
    await emit('GUARD', 'Bảng cấu hình đã mở, không click lại.');
  }

  const modeText = settings.mode === 'Image' ? 'Hình ảnh' : 'Video';
  await chooseTab(page, modeText, `mode ${settings.mode}`, emit);

  if (settings.mode === 'Video') {
    if (settings.inputType) await chooseTab(page, settings.inputType, `loại ${settings.inputType}`, emit);
    if (settings.aspect) await chooseTab(page, settings.aspect, `tỷ lệ ${settings.aspect}`, emit);
    if (settings.count) await chooseTab(page, countLabel(settings.count), `số lượng ${settings.count}`, emit);
    if (settings.duration) await chooseTab(page, settings.duration, `thời lượng ${settings.duration}`, emit);
  } else {
    if (settings.aspect) await chooseTab(page, settings.aspect, `tỷ lệ ${settings.aspect}`, emit);
    if (settings.count) await chooseTab(page, countLabel(settings.count), `số lượng ${settings.count}`, emit);
  }

  const modelDropdown = await visibleUnique(
    page
      .getByRole('button')
      .filter({ hasText: 'arrow_drop_down' }),
    'Model dropdown',
  );
  const currentModel = await modelDropdown.innerText();
  if (!currentModel.includes(settings.model)) {
    await observedClick(page, modelDropdown, 'mở danh sách model', emit);
    const modelItem = await visibleUnique(
      page.getByRole('menuitem').filter({ hasText: settings.model }),
      `model ${settings.model}`,
    );
    await observedClick(page, modelItem, `model ${settings.model}`, emit);
  } else {
    await emit('GUARD', `Model ${settings.model} đã được chọn, bỏ qua.`);
  }

  await page.keyboard.press('Escape').catch(() => {});
  if (await anyVisible(aspectProbe)) {
    await observedClick(
      page,
      configButton,
      'đóng bảng cấu hình',
      emit,
      { checkDialogs: false },
    );
  }
  if (await anyVisible(aspectProbe)) {
    throw new Error(
      'Bảng cấu hình chưa đóng; chặn nhập prompt để tránh thao tác nhầm lớp UI.',
    );
  }
  const summary = await configButton.innerText();
  
  let isValid = summary.includes(settings.model);
  if (settings.aspect) {
     const icon = ASPECT_ICON[settings.aspect];
     if (icon && !summary.includes(icon) && !summary.includes(settings.aspect)) isValid = false;
  }
  
  if (settings.mode === 'Video' && settings.duration) {
     if (!summary.includes(settings.duration)) isValid = false;
  }
  
  if (!isValid) {
    throw new Error(
      `Flow settings verification failed. Expected: ${settings.mode} / ${settings.model} / ${settings.aspect} / ${settings.count} / ${settings.duration || ''}. Current summary chip: "${summary}"`
    );
  }
  await emit(
    'SUCCESS',
    `Đã xác minh ${settings.mode} · ${settings.model} · ${settings.aspect} · ${settings.count}` + (settings.duration ? ` · ${settings.duration}` : ''),
  );
}

async function getPromptAttachments(page) {
  const { textbox } = await composerFor(page);
  const container = textbox.locator('..').locator('..').locator('..');
  return container.locator('button:has(i:text-is("cancel"))');
}

async function attachReference(page, ref, index, total, currentAttachmentCount, emit, updateState) {
  const referenceUrl = ref.filePath;
  if (!referenceUrl) return currentAttachmentCount;
  const filePath = referenceFilePath(referenceUrl);
  if (!filePath) throw new Error('Reference path is invalid.');
  const { composer } = await composerFor(page);
  const addButton = await visibleUnique(
    composer.locator('button[aria-haspopup="dialog"]'),
    'Add reference',
  );
  await observedClick(page, addButton, 'mở Reference picker', emit);

  const uploadButton = await visibleUnique(
    page.getByRole('button').filter({ hasText: 'Tải nội dung nghe nhìn lên' }),
    'Tải nội dung nghe nhìn lên',
  );

  const observation = await observeBeforeAction(uploadButton);
  await updateState('uploading_reference', `uploading_reference: tải ảnh ${index + 1}/${total} (${ref.fileName})`);
  await emit('ACTION', `Bắt đầu upload reference: ${filePath}`);
  const chooserPromise = page.waitForEvent('filechooser', {
    timeout: 30_000,
  });
  await emit('OBSERVE', 'UI ổn định tại Upload reference.', {
    mutations: observation.mutationCount,
  });
  await assertNoUnexpectedUi(page, uploadButton);
  await showActionIndicator(page, uploadButton, {
    action: 'upload',
    control: 'Upload reference',
    previewMs: 450,
  });
  await emit('ACTION', `Upload reference ${referenceUrl}`);
  try {
    const chooserPromise = page.waitForEvent('filechooser', {
      timeout: 8_000,
    });
    await uploadButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  } finally {
    await clearActionIndicator(page);
  }

  const deadline = Date.now() + 45_000;
  let after = currentAttachmentCount;
  let attached = false;
  
  while (Date.now() < deadline) {
    after = await getPromptAttachments(page).count();
    if (after > currentAttachmentCount) {
      attached = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!attached) {
    throw new Error('Reference was uploaded but Flow did not confirm attachment in the prompt.');
  }
  return after;
}

class SubmittedButUntrackedError extends Error {
  constructor(message) {
    super(message);
    this.submitted = true;
  }
}

async function waitForNewTiles(
  page,
  knownTileIds,
  expectedCount,
  emit,
) {
  const deadline = Date.now() + 30_000;
  await emit(
    'OBSERVE',
    `Đang chờ Flow tạo ${expectedCount} tile để gắn đúng kết quả với job.`,
  );
  while (Date.now() < deadline) {
    const tiles = await mediaTiles(page);
    const created = tiles.filter(
      (tile) => tile.id && !knownTileIds.has(tile.id),
    );
    if (created.length > expectedCount) {
      throw new SubmittedButUntrackedError(
        `Xuất hiện ${created.length} tile mới trong khi job cần ${expectedCount}. Không thể ánh xạ an toàn; có thể Flow đang được thao tác thủ công song song.`,
      );
    }
    if (created.length >= expectedCount) {
      const assigned = created.slice(0, expectedCount);
      await emit(
        'SUCCESS',
        `Đã gắn tile ${assigned.map((tile) => tile.id).join(', ')} với job.`,
      );
      return assigned;
    }
    await page.waitForTimeout(300);
  }
  throw new SubmittedButUntrackedError(
    'Flow đã nhận Generate nhưng không xuất hiện tile mới trong 30 giây. Dừng gửi thêm để tránh ánh xạ nhầm kết quả.',
  );
}

async function submitJob(
  page,
  runtimePayload,
  knownTileIds,
  emit,
  updateState,
) {
  await updateState('preparing', `preparing job with ${runtimePayload.references.length} references: ${runtimePayload.references.map(r => r.fileName).join(', ')}`);
  
  const initialComposer = await composerFor(page);
  
  const staleAttachments = await getPromptAttachments(page);
  const staleCount = await staleAttachments.count();
  if (staleCount > 0) {
    try {
      for (let i = 0; i < staleCount; i++) {
        const cancelBtn = staleAttachments.nth(0).locator('i:text-is("cancel")');
        if (await cancelBtn.isVisible()) {
           await cancelBtn.click();
           await page.waitForTimeout(500);
        }
      }
    } catch(e) {}
    
    const staleAfter = await getPromptAttachments(page).count();
    if (staleAfter > 0) {
      throw new Error(
        `Composer vẫn còn ${staleAfter} reference cũ từ job trước. Không thể xóa tự động.`
      );
    }
  }

  let currentAttachmentCount = 0;
  const total = runtimePayload.references.length;
  for (let i = 0; i < total; i++) {
    const ref = runtimePayload.references[i];
    currentAttachmentCount = await attachReference(page, ref, i, total, currentAttachmentCount, emit, updateState);
  }
  
  if (total > 0) {
    await emit('SUCCESS', `all references attached`);
  }

  await updateState('prompt_ready', 'Điền prompt text');
  const { textbox, composer } = await composerFor(page);
  await observedFill(
    page,
    textbox,
    runtimePayload.prompt,
    `prompt job-${runtimePayload.jobId}`,
    emit,
  );
  const currentPrompt = (await textbox.innerText()).trim();
  if (!currentPrompt.includes(runtimePayload.prompt.slice(0, 80))) {
    throw new Error('Prompt verification failed after fill.');
  }
  await emit('SUCCESS', `Đã điền và xác minh prompt.`);

  const generateButton = await visibleUnique(
    composer.locator(
      'button:not([aria-haspopup]):has-text("arrow_forward")',
    ),
    'Generate',
  );
  if (!(await generateButton.isEnabled())) {
    throw new Error('Generate button is disabled after prompt fill.');
  }
  await updateState('generating', `Đã gửi lệnh tạo sang Flow.`);
  await observedClick(page, generateButton, 'Generate', emit);
  
  const tiles = await waitForNewTiles(
    page,
    knownTileIds,
    expectedOutputCount(runtimePayload.config.count),
    emit,
  );
  return { tileIds: tiles.map((tile) => tile.id) };
}

function contentExtension(contentType, mediaType) {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    return '.jpg';
  }
  if (contentType.includes('mp4') || mediaType === 'video') return '.mp4';
  return mediaType === 'image' ? '.jpg' : '.bin';
}

async function downloadCompletedTile(page, run, job, tile, index) {
  const response = await page.context().request.get(tile.mediaUrl, {
    timeout: 120_000,
  });
  if (!response.ok()) {
    throw new Error(
      `Tải tile ${tile.id} thất bại: HTTP ${response.status()}.`,
    );
  }
  const contentType = response.headers()['content-type'] || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(
      `Tile ${tile.id} trả về "${contentType}", không phải ảnh.`,
    );
  }
  const safeCode = String(job.code || `job-${job.id}`).replace(
    /[^a-z0-9._-]+/gi,
    '_',
  );
  const extension = contentExtension(contentType, tile.mediaType);
  return saveOutputMedia(
    run,
    `${safeCode}_${String(index + 1).padStart(2, '0')}${extension}`,
    await response.body(),
  );
}

async function monitorSubmittedJobs({
  page,
  run,
  submitted,
  onJobUpdate,
  emitFor,
}) {
  const timeoutMs = Number(
    process.env.FLOW_RESULT_TIMEOUT_MS || 20 * 60 * 1000,
  );
  const deadline = Date.now() + timeoutMs;
  const pending = new Map(
    submitted.map((item) => [
      item.job.id,
      {
        ...item,
        lastProgress: -1,
      },
    ]),
  );

  while (pending.size > 0 && Date.now() < deadline) {
    const tiles = await mediaTiles(page);
    const tileMap = new Map(tiles.map((tile) => [tile.id, tile]));

    for (const [jobId, item] of pending) {
      const currentTiles = item.tileIds
        .map((tileId) => tileMap.get(tileId))
        .filter(Boolean);
      const progress =
        currentTiles.length === 0
          ? item.lastProgress < 0
            ? 0
            : item.lastProgress
          : Math.round(
              currentTiles.reduce(
                (sum, tile) => sum + tile.progress,
                0,
              ) / item.tileIds.length,
            );
      if (progress !== item.lastProgress) {
        item.lastProgress = progress;
        await onJobUpdate(item.job, {
          status: 'running',
          progress,
          runFolder: run.name,
        });
        const manifest = manifestJob(run, jobId);
        manifest.progress = progress;
        manifest.status = 'running';
        await saveRunManifest(run);
        await emitFor(item.job)(
          'OBSERVE',
          `Flow đang render ${progress}% (${currentTiles.length}/${item.tileIds.length} tile đang quan sát).`,
        );
      }

      const failure = currentTiles.find(
        (tile) =>
          /\b(error|failed|failure|try again)\b|lỗi|thất bại|thử lại/i.test(
            tile.text,
          ),
      );
      if (failure) {
        await onJobUpdate(item.job, {
          status: 'error',
          progress,
          runFolder: run.name,
        });
        const manifest = manifestJob(run, jobId);
        manifest.status = 'error';
        manifest.error = failure.text;
        await saveRunManifest(run);
        await emitFor(item.job)(
          'ERROR',
          `Flow báo lỗi tại tile ${failure.id}: ${failure.text}`,
        );
        pending.delete(jobId);
        continue;
      }

      if (
        currentTiles.length === item.tileIds.length &&
        currentTiles.every((tile) => tile.mediaUrl)
      ) {
        try {
          const saved = [];
          for (let index = 0; index < currentTiles.length; index += 1) {
            saved.push(
              await downloadCompletedTile(
                page,
                run,
                item.job,
                currentTiles[index],
                index,
              ),
            );
          }
          const urls = saved.map((result) => result.url);
          await onJobUpdate(item.job, {
            status: 'done',
            progress: 100,
            result: urls[0],
            results: urls,
            runFolder: run.name,
          });
          const manifest = manifestJob(run, jobId);
          manifest.status = 'done';
          manifest.progress = 100;
          manifest.results = saved.map((result, index) => ({
            tileId: currentTiles[index]?.id,
            fileName: result.fileName,
            filePath: result.filePath,
          }));
          await saveRunManifest(run);
          await emitFor(item.job)(
            'SUCCESS',
            `Render hoàn tất; đã lưu ${saved.length} ảnh vào ${run.directory}.`,
          );
        } catch (error) {
          await onJobUpdate(item.job, {
            status: 'error',
            progress: 100,
            runFolder: run.name,
          });
          const manifest = manifestJob(run, jobId);
          manifest.status = 'error';
          manifest.error = error.message;
          await saveRunManifest(run);
          await emitFor(item.job)('ERROR', error.message);
        }
        pending.delete(jobId);
      }
    }
    if (pending.size > 0) await page.waitForTimeout(1_000);
  }

  for (const item of pending.values()) {
    await onJobUpdate(item.job, {
      status: 'error',
      progress: Math.max(0, item.lastProgress),
      runFolder: run.name,
    });
    const manifest = manifestJob(run, item.job.id);
    manifest.status = 'error';
    manifest.error = `Timeout sau ${Math.round(timeoutMs / 60_000)} phút.`;
    await saveRunManifest(run);
    await emitFor(item.job)(
      'ERROR',
      `Hết thời gian theo dõi sau ${Math.round(timeoutMs / 60_000)} phút.`,
    );
  }
}

export async function runFlowBatch({
  page,
  batch,
  workspaceId,
  selectedIds,
  dryRun = false,
  onEvent = () => {},
  onJobUpdate = async () => {},
}) {
  const selected = batch.jobs.filter((job) => selectedIds.has(job.id));
  if (selected.length === 0) throw new Error('No batch jobs selected.');
  if (batch.settings.mode !== 'Image' && batch.settings.mode !== 'Video') {
    throw new Error('Unsupported mode: ' + batch.settings.mode);
  }
  if (!dryRun) {
    const unsafeJobs = selected.filter((job) =>
      ['running', 'done'].includes(job.status),
    );
    if (unsafeJobs.length > 0) {
      throw new Error(
        `Duplicate submission blocked for ${unsafeJobs
          .map((job) => `${job.code} (${job.status})`)
          .join(', ')}. Use the row retry button to explicitly reset a job before running it again.`,
      );
    }
  }

  const emitFor = (job) => async (level, message, data = {}) => {
    await onEvent({
      level,
      message: `[${workspaceId}/${job.id}] ${message}`,
      jobId: job.id,
      ...data,
    });
  };

  if (dryRun) {
    const probeJob = selected[0];
    const emit = emitFor(probeJob);
    await configureFlow(page, batch.settings, emit);
    const { composer } = await composerFor(page);
    await visibleUnique(
      composer.locator('button[aria-haspopup="dialog"]'),
      'Add reference',
    );
    await visibleUnique(
      composer.locator(
        'button:not([aria-haspopup]):has-text("arrow_forward")',
      ),
      'Generate',
    );
    await onEvent({
      level: 'SUCCESS',
      message: `Dry-run: đã xác minh composer, mode, model, tỷ lệ, số lượng, reference picker và Generate; ${selected.length} job hợp lệ.`,
    });
    return selected.map((job) => ({
      id: job.id,
      status: 'ready',
    }));
  }

  const run = await createOutputRun({
    settings: batch.settings,
    jobs: selected,
  });
  await onEvent({
    level: 'SUCCESS',
    message: `Đã tạo thư mục output cho lần Run: ${run.directory}`,
  });

  const baselineTiles = await mediaTiles(page);
  const knownTileIds = new Set(
    baselineTiles.map((tile) => tile.id).filter(Boolean),
  );
  const submitted = [];
  const firstEmit = emitFor(selected[0]);
  await configureFlow(page, batch.settings, firstEmit);
  const submitDelayMs = Math.min(
    15_000,
    Math.max(800, Number(batch.settings.submitDelayMs || 2500)),
  );

  for (let jobIndex = 0; jobIndex < selected.length; jobIndex += 1) {
    const job = selected[jobIndex];
    const emit = emitFor(job);
    try {
      await onJobUpdate(job, {
        status: 'running',
        progress: 0,
        result: null,
        results: [],
        runFolder: run.name,
      });
      const manifest = manifestJob(run, job.id);
      manifest.status = 'submitting';
      const emit = emitFor(job);
      const updateState = async (stateString, message) => {
        await onJobUpdate(job, { status: stateString });
        if (message) await emit('INFO', message);
      };

      const runtimeReferences = (job.references || [])
        .map((ref, index) => {
          if (!ref) return null;
          return {
            slotIndex: index,
            filePath: ref,
            fileName: ref.split('/').pop()
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.slotIndex - b.slotIndex);

      const runtimePayload = {
        workspaceId,
        jobId: job.id,
        prompt: job.prompt,
        references: runtimeReferences,
        config: batch.settings
      };

      await emit('INFO', `Runtime payload: ${runtimeReferences.length} references: ${runtimeReferences.map(r => r.fileName).join(', ')}`);

      const { tileIds } = await submitJob(
        page,
        runtimePayload,
        knownTileIds,
        emit,
        updateState,
      );
      tileIds.forEach((tileId) => knownTileIds.add(tileId));
      manifest.tileIds = tileIds;
      manifest.status = 'running';
      await saveRunManifest(run);
      submitted.push({ job, tileIds });
      await emit(
        'SUCCESS',
        `Đã gửi; tiếp tục job kế tiếp mà không chờ render hoàn tất.`,
      );
      if (jobIndex < selected.length - 1) {
        await emit(
          'WAIT',
          `Delay an toàn ${(submitDelayMs / 1000).toFixed(1)} giây trước job kế tiếp.`,
        );
        await page.waitForTimeout(submitDelayMs);
      }
    } catch (error) {
      const manifest = manifestJob(run, job.id);
      if (error.submitted) {
        manifest.status = 'untracked';
        manifest.error = error.message;
        await saveRunManifest(run);
        await emit('GUARD', error.message);
        break;
      }
      await onJobUpdate(job, {
        status: 'error',
        progress: 0,
        result: error.message,
        runFolder: run.name,
      });
      manifest.status = 'error';
      manifest.error = error.message;
      await saveRunManifest(run);
      await emit('ERROR', error.message);
    }
  }

  if (submitted.length > 0) {
    await onEvent({
      level: 'OBSERVE',
      message: `Đã gửi ${submitted.length}/${selected.length} job. Bắt đầu theo dõi tất cả tile song song.`,
    });
    await monitorSubmittedJobs({
      page,
      run,
      submitted,
      onJobUpdate,
      emitFor,
    });
  }

  return selected.map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    results: job.results,
    runFolder: job.runFolder,
  }));
}
