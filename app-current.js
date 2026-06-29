const elements = {
  topTabs: [...document.querySelectorAll('.top-tab[data-view]')],
  views: [...document.querySelectorAll('[data-view-panel]')],
  chromeStatus: document.querySelector('#chromeStatus'),
  flowStatus: document.querySelector('#flowStatus'),
  guardStatus: document.querySelector('#guardStatus'),
  cdpValue: document.querySelector('#cdpValue'),
  registryValue: document.querySelector('#registryValue'),
  tabsValue: document.querySelector('#tabsValue'),
  operationValue: document.querySelector('#operationValue'),
  recipeName: document.querySelector('#recipeName'),
  recipeSelect: document.querySelector('#recipeSelect'),
  forceRepeat: document.querySelector('#forceRepeat'),
  logs: document.querySelector('#logs'),
  startChrome: document.querySelector('#startChrome'),
  authCookie: document.querySelector('#authCookie'),
  recordStart: document.querySelector('#recordStart'),
  recordStop: document.querySelector('#recordStop'),
  replaySafe: document.querySelector('#replaySafe'),
  replayCommit: document.querySelector('#replayCommit'),
  resetRegistry: document.querySelector('#resetRegistry'),
  clearLogs: document.querySelector('#clearLogs'),
  workspaceTabs: document.querySelector('#workspaceTabs'),
  newWorkspace: document.querySelector('#newWorkspace'),
  batchRows: document.querySelector('#batchRows'),
  selectedJobs: document.querySelector('#selectedJobs'),
  totalJobs: document.querySelector('#totalJobs'),
  addRow: document.querySelector('#addRow'),
  selectAll: document.querySelector('#selectAll'),
  testBatch: document.querySelector('#testBatch'),
  runBatch: document.querySelector('#runBatch'),
  runErrors: document.querySelector('#runErrors'),
  generationMode: document.querySelector('#generationMode'),
  modelSelect: document.querySelector('#modelSelect'),
  aspectSelect: document.querySelector('#aspectSelect'),
  countSelect: document.querySelector('#countSelect'),
  delaySelect: document.querySelector('#delaySelect'),
  inputTypeSelect: document.querySelector('#inputTypeSelect'),
  durationSelect: document.querySelector('#durationSelect'),
  exportSrt: document.querySelector('#exportSrt'),
  exportPrompts: document.querySelector('#exportPrompts'),
  deleteRows: document.querySelector('#deleteRows'),
  clearRows: document.querySelector('#clearRows'),
  referenceFile: document.querySelector('#referenceFile'),
  imageModal: document.querySelector('#imageModal'),
  closeImageModal: document.querySelector('#closeImageModal'),
  modalImage: document.querySelector('#modalImage'),
  modalImageLabel: document.querySelector('#modalImageLabel'),
  replaceReference: document.querySelector('#replaceReference'),
  deleteReference: document.querySelector('#deleteReference'),
  flowSessions: document.querySelector('#flowSessions'),
  newFlowSession: document.querySelector('#newFlowSession'),
  directorProvider: document.querySelector('#directorProvider'),
  directorProviderStatus: document.querySelector(
    '#directorProviderStatus',
  ),
  openAiStudio: document.querySelector('#openAiStudio'),
  styleAnalyzer: document.querySelector('#styleAnalyzer'),
  styleReferences: document.querySelector('#styleReferences'),
  styleReferenceCount: document.querySelector('#styleReferenceCount'),
  copyStyleAnalyzer: document.querySelector('#copyStyleAnalyzer'),
  styleDna: document.querySelector('#styleDna'),
  filmType: document.querySelector('#filmType'),
  scriptLanguage: document.querySelector('#scriptLanguage'),
  characterAnalyzer: document.querySelector('#characterAnalyzer'),
  characterReference: document.querySelector('#characterReference'),
  characterReferenceName: document.querySelector(
    '#characterReferenceName',
  ),
  copyCharacterAnalyzer: document.querySelector(
    '#copyCharacterAnalyzer',
  ),
  characterDna: document.querySelector('#characterDna'),
  preserveScript: document.querySelector('#preserveScript'),
  storyMode: document.querySelector('#storyMode'),
  allowText: document.querySelector('#allowText'),
  targetSceneSeconds: document.querySelector('#targetSceneSeconds'),
  storyInput: document.querySelector('#storyInput'),
  masterJson: document.querySelector('#masterJson'),
  masterStats: document.querySelector('#masterStats'),
  compileDirector: document.querySelector('#compileDirector'),
  copyDirectorInstruction: document.querySelector(
    '#copyDirectorInstruction',
  ),
  copyMasterJson: document.querySelector('#copyMasterJson'),
  runMasterFlow: document.querySelector('#runMasterFlow'),
};

const samplePrompts = [
  'A cinematic establishing shot of a futuristic coastal city at blue hour, glowing architecture, natural atmospheric depth, premium editorial composition.',
  'Close portrait of the main character under soft window light, realistic skin texture, confident expression, shallow depth of field, clean background.',
  'A dynamic street scene in light rain, reflections across dark pavement, subtle motion blur, dramatic practical lighting, coherent character design.',
  'Wide aerial view above layered mountain valleys at sunrise, volumetric clouds, warm rim light, highly detailed but natural color grading.',
  'Minimal product composition on a sculpted stone pedestal, soft cyan and amber lighting, precise shadows, luxury advertising photography.',
  'An intimate interior scene with the character reading beside a large window, quiet mood, warm practical lights, cinematic framing.',
];

let jobs = samplePrompts.map((prompt, index) => ({
  id: index + 1,
  code: `S${Math.floor(index / 3) + 1}.${(index % 3) + 1}`,
  selected: index < 2,
  prompt,
  references: [null, null, null, null, null],
  hasResult: index === 0,
  status: index === 0 ? 'done' : index === 4 ? 'error' : 'waiting',
}));
let pendingReference = null;
let modalReference = null;
let persistTimer = null;
let studioPersistTimer = null;

let currentWorkspaceId = localStorage.getItem('currentWorkspaceId') || null;
let workspaces = [];

async function loadWorkspaces() {
  try {
    const response = await fetch('/api/batch/workspaces', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    workspaces = result.workspaces || [];
    
    if (workspaces.length > 0) {
      if (!currentWorkspaceId || !workspaces.find((w) => w.id === currentWorkspaceId)) {
        currentWorkspaceId = workspaces[0].id;
        localStorage.setItem('currentWorkspaceId', currentWorkspaceId);
      }
    }
    renderWorkspaceTabs();
  } catch (error) {
    localLog('ERROR', `Lỗi tải workspaces: ${error.message}`);
  }
}

function renderWorkspaceTabs() {
  if (!elements.workspaceTabs) return;
  elements.workspaceTabs.innerHTML = workspaces
    .map(
      (w) => `
    <button class="workspace-tab ${w.id === currentWorkspaceId ? 'active' : ''}" data-workspace-id="${escapeHtml(w.id)}" title="Click đúp để đổi tên">
      <span>${escapeHtml(w.title)}</span>
    </button>
  `
    )
    .join('');
}

function appendLog(event) {
  const line = document.createElement('div');
  line.className = `log-line level-${event.level}`;
  const time = new Date(event.at).toLocaleTimeString('vi-VN', {
    hour12: false,
  });
  line.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level">[${event.level}]</span>
    <span>${escapeHtml(event.message)}</span>
  `;
  elements.logs.appendChild(line);
  while (elements.logs.children.length > 500) {
    elements.logs.firstElementChild.remove();
  }
  elements.logs.scrollTop = elements.logs.scrollHeight;
}

function statusLabel(job) {
  if (job.status === 'done') return 'XONG';
  if (job.status === 'error') return 'LỖI';
  if (job.status === 'running' || job.status === 'generating') {
    return `ĐANG ${Math.max(0, Number(job.progress || 0))}%`;
  }
  if (job.status === 'waiting' || job.status === 'pending') return 'CHỜ';
  
  const labels = {
    preparing: 'CHUẨN BỊ',
    clearing_previous_attachments: 'DỌN DẸP',
    uploading_reference: 'ĐANG UP ẢNH',
    waiting_reference_ready: 'CHỜ ẢNH',
    attaching_reference: 'GẮN ẢNH',
    reference_attached: 'ĐÃ GẮN ẢNH',
    prompt_ready: 'GÕ PROMPT',
  };
  return labels[job.status] || job.status.toUpperCase();
}

function batchPayload() {
  return {
    settings: {
      mode: elements.generationMode.value,
      inputType: elements.inputTypeSelect.value,
      model: elements.modelSelect.value,
      duration: elements.durationSelect.value,
      aspect: elements.aspectSelect.value,
      count: elements.countSelect.value,
      submitDelayMs: Number(elements.delaySelect.value),
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      code: job.code,
      selected: job.selected,
      prompt: job.prompt,
      references: job.references,
      result: job.hasResult ? job.result || 'demo' : null,
      results: Array.isArray(job.results) ? job.results : [],
      progress: Number(job.progress || 0),
      runFolder: job.runFolder || null,
      status: job.status,
    })),
  };
}

async function saveActiveBatch() {
  const payload = {
    batch: batchPayload(),
    workspaceId: currentWorkspaceId,
  };
  await request('/api/batch/save', payload);
}

function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void saveActiveBatch().catch((error) => {
      localLog('ERROR', `Không lưu được batch: ${error.message}`);
    });
  }, 280);
}

async function loadBatchState() {
  const query = currentWorkspaceId ? `?workspaceId=${currentWorkspaceId}` : '';
  const response = await fetch(`/api/batch${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được batch project.');
  const batch = await response.json();
  jobs = batch.jobs.map((job) => ({
    ...job,
    references: Array.isArray(job.references)
      ? job.references
      : [null, null, null, null, null],
    results: Array.isArray(job.results) ? job.results : [],
    progress: Number(job.progress || 0),
    hasResult: Boolean(job.result || job.results?.length),
  }));
  elements.generationMode.value = batch.settings.mode;
  elements.inputTypeSelect.value = batch.settings.inputType || 'Khung hình';
  elements.modelSelect.value = batch.settings.model;
  elements.durationSelect.value = batch.settings.duration || '6s';
  elements.aspectSelect.value = batch.settings.aspect;
  elements.countSelect.value = batch.settings.count;
  elements.delaySelect.value = String(
    batch.settings.submitDelayMs || 2500,
  );
  updateConfigUI();
  // We need to set them again after updateConfigUI to ensure they stick if they are valid
  if (batch.settings.inputType) elements.inputTypeSelect.value = batch.settings.inputType;
  if (batch.settings.model) elements.modelSelect.value = batch.settings.model;
  if (batch.settings.duration) elements.durationSelect.value = batch.settings.duration;
}

function renderJobs() {
  elements.batchRows.innerHTML = jobs
    .map((job, index) => {
      const resultUrl =
        job.results?.[0] ||
        (String(job.result || '').startsWith('/output-assets/')
          ? job.result
          : null);
      return `
        <tr class="${job.selected ? 'selected' : ''}" data-job-id="${job.id}">
          <td class="job-stt">
            <div>${index + 1}</div>
            <input
              class="job-check"
              type="checkbox"
              aria-label="Chọn job ${index + 1}"
              ${job.selected ? 'checked' : ''}
            />
          </td>
          <td>
            <div class="job-code">${escapeHtml(job.code)}</div>
          </td>
          <td>
            <div class="ref-slots" aria-label="Reference job ${index + 1}">
              ${Array.from({ length: 5 }, (_, slot) => {
                const reference = job.references?.[slot];
                const style = reference
                  ? ` style="background-image:url('${escapeHtml(reference)}');background-size:cover;background-position:center"`
                  : '';
                return `<button class="ref-slot ${
                  reference ? 'has-reference' : ''
                }" data-action="reference" data-slot="${slot}" aria-label="${
                  reference ? 'Đổi' : 'Thêm'
                } reference ${slot + 1}"${style}></button>`;
              }).join('')}
            </div>
            <div class="row-tools">
              <button class="mini-btn" data-action="gen-ref">Gen</button>
              <button class="mini-btn amber" data-action="import-ref">Import</button>
              <button class="mini-btn" data-action="play-ref">▶ Play</button>
            </div>
          </td>
          <td>
            <textarea class="prompt-box" aria-label="Prompt job ${
              index + 1
            }">${escapeHtml(job.prompt)}</textarea>
            <div class="row-tools">
              <button class="mini-btn amber" data-action="edit-sub">Sửa SUB</button>
              <button class="mini-btn cyan" data-action="edit-prompt">Sửa Prompt</button>
            </div>
          </td>
          <td>
            <div class="result-preview ${
              job.hasResult ? '' : 'empty'
            }" data-action="open-result"${
              resultUrl
                ? ` data-result-url="${escapeHtml(resultUrl)}"`
                : ''
            }>
              ${
                resultUrl
                  ? `<img src="${escapeHtml(
                      resultUrl,
                    )}" alt="Kết quả ${escapeHtml(job.code)}" />`
                  : job.hasResult
                    ? 'FLOW'
                    : 'Chưa Render Ảnh'
              }
            </div>
            <div class="row-tools">
              <button class="mini-btn" data-action="open-result">Mở</button>
              <button class="mini-btn purple" data-action="make-video">Tạo Video</button>
            </div>
          </td>
          <td class="progress-cell">
            <span class="progress-badge ${job.status}">
              ${statusLabel(job)}
            </span>
            <div class="progress-actions">
              <button data-action="retry" title="Chạy lại">↻</button>
              <button data-action="folder" title="Mở thư mục">▣</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  elements.totalJobs.textContent = jobs.length;
  elements.selectedJobs.textContent = jobs.filter(
    (job) => job.selected,
  ).length;
  elements.selectAll.classList.toggle(
    'active',
    jobs.length > 0 && jobs.every((job) => job.selected),
  );
}

function jobFromElement(element) {
  const row = element.closest('[data-job-id]');
  return jobs.find((job) => job.id === Number(row?.dataset.jobId));
}

function selectedBatchJobs() {
  return jobs.filter((job) => job.selected);
}

function openReferenceModal(job, slot) {
  const reference = job.references?.[slot];
  if (!reference) return;
  modalReference = { jobId: job.id, slot };
  elements.modalImage.src = reference;
  elements.modalImageLabel.textContent = `${job.code} · Reference ${
    slot + 1
  }`;
  elements.replaceReference.hidden = false;
  elements.deleteReference.hidden = false;
  elements.imageModal.hidden = false;
}

function openResultModal(job, resultUrl) {
  if (!resultUrl) return;
  modalReference = null;
  elements.modalImage.src = resultUrl;
  elements.modalImageLabel.textContent = `${job.code} · ${job.runFolder || 'Output'}`;
  elements.replaceReference.hidden = true;
  elements.deleteReference.hidden = true;
  elements.imageModal.hidden = false;
}

function closeReferenceModal() {
  elements.imageModal.hidden = true;
  elements.modalImage.removeAttribute('src');
  modalReference = null;
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function localLog(level, message) {
  appendLog({
    at: new Date().toISOString(),
    level,
    message,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function request(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flow-Observer': '1',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Request failed.');
    error.serverReported = true;
    throw error;
  }
  return result;
}

function switchView(name) {
  elements.topTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
  elements.views.forEach((view) => {
    view.hidden = view.dataset.viewPanel !== name;
  });
}

async function copyText(text, label) {
  const value = String(text || '').trim();
  if (!value) {
    localLog('GUARD', `${label} đang trống.`);
    return;
  }
  await navigator.clipboard.writeText(value);
  localLog('SUCCESS', `Đã copy ${label}.`);
}

function collectScriptStudio() {
  return {
    provider: elements.directorProvider.value,
    styleAnalyzer: elements.styleAnalyzer.value,
    styleDna: elements.styleDna.value,
    characterAnalyzer: elements.characterAnalyzer.value,
    characterDna: elements.characterDna.value,
    filmType: elements.filmType.value,
    language: elements.scriptLanguage.value,
    preserveScript: elements.preserveScript.checked,
    storyMode: elements.storyMode.checked,
    allowText: elements.allowText.checked,
    targetSceneSeconds: Number(elements.targetSceneSeconds.value),
    story: elements.storyInput.value,
    masterJson: elements.masterJson.value,
  };
}

function updateMasterStats() {
  try {
    const master = JSON.parse(elements.masterJson.value || '{}');
    const scenes = Array.isArray(master.scenes) ? master.scenes : [];
    const prompts = scenes.reduce(
      (total, scene) =>
        total + (Array.isArray(scene.prompts) ? scene.prompts.length : 0),
      0,
    );
    const duration = Number(master.project?.totalDuration || 0);
    elements.masterStats.textContent = `${scenes.length} scene · ${prompts} prompt${
      duration ? ` · ${duration}s` : ''
    }`;
  } catch {
    elements.masterStats.textContent = 'JSON chưa hợp lệ';
  }
}

function applyScriptStudio(studio) {
  elements.directorProvider.value = studio.provider || 'local';
  elements.styleAnalyzer.value = studio.styleAnalyzer || '';
  elements.styleDna.value = studio.styleDna || '';
  elements.characterAnalyzer.value = studio.characterAnalyzer || '';
  elements.characterDna.value = studio.characterDna || '';
  elements.filmType.value = studio.filmType || 'Cinematic story';
  elements.scriptLanguage.value = studio.language || 'Tiếng Việt';
  elements.preserveScript.checked = studio.preserveScript !== false;
  elements.storyMode.checked = Boolean(studio.storyMode);
  elements.allowText.checked = Boolean(studio.allowText);
  elements.targetSceneSeconds.value = String(
    studio.targetSceneSeconds || 10,
  );
  elements.storyInput.value = studio.story || '';
  elements.masterJson.value = studio.masterJson || '';
  elements.directorProviderStatus.textContent =
    studio.provider === 'manual-ai-studio'
      ? 'MANUAL AI STUDIO'
      : 'LOCAL DRAFT';
  updateMasterStats();
}

function scheduleStudioPersist() {
  window.clearTimeout(studioPersistTimer);
  studioPersistTimer = window.setTimeout(() => {
    void request(
      '/api/script-studio/save',
      collectScriptStudio(),
    ).catch((error) => {
      if (!error.serverReported) {
        localLog('ERROR', `Không lưu được Script Studio: ${error.message}`);
      }
    });
  }, 350);
}

async function loadScriptStudioState() {
  const response = await fetch('/api/script-studio', {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Không tải được Script Studio.');
  applyScriptStudio(await response.json());
}

async function loadFlowSessions() {
  const response = await fetch('/api/flow/sessions', {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Không đọc được Flow sessions.');
  const result = await response.json();
  elements.flowSessions.innerHTML = result.sessions.length
    ? result.sessions
        .map(
          (session) => `
            <button
              class="flow-session ${session.active ? 'active' : ''}"
              role="tab"
              data-session-id="${escapeHtml(session.id)}"
              title="${escapeHtml(session.url)}"
            >${escapeHtml(session.label)} · ${escapeHtml(
              session.id.slice(0, 8),
            )}</button>
          `,
        )
        .join('')
    : '<span class="file-count">Chưa có project đang mở</span>';
}

async function withButton(button, label, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } catch (error) {
    if (!error.serverReported) localLog('ERROR', error.message);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = original;
    await refreshStatus();
  }
}

function selectedRecipe() {
  return elements.recipeSelect.value || elements.recipeName.value.trim();
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const status = await response.json();
    elements.chromeStatus.textContent = status.chrome.connected
      ? 'CHROME ON'
      : 'CHROME OFF';
    elements.chromeStatus.className = `chip ${
      status.chrome.connected ? 'online' : 'offline'
    }`;
    elements.flowStatus.textContent = status.chrome.flowOpen
      ? 'FLOW READY'
      : 'FLOW CLOSED';
    elements.flowStatus.className = `chip ${
      status.chrome.flowOpen ? 'online' : 'offline'
    }`;
    elements.cdpValue.textContent = status.chrome.endpoint || '—';
    elements.registryValue.textContent = status.registryCount;
    elements.tabsValue.textContent = status.chrome.tabCount;
    elements.operationValue.textContent =
      status.operation ||
      (status.recorder ? `REC: ${status.recorder}` : 'IDLE');

    const previous = elements.recipeSelect.value;
    const recipeNames = status.recipes.map((recipe) => recipe.name);
    elements.recipeSelect.innerHTML = status.recipes.length
      ? status.recipes
          .map(
            (recipe) => {
              const health =
                recipe.missingControls > 0
                  ? ` · THIẾU ${recipe.missingControls} LOCATOR`
                  : ` · ${recipe.steps} BƯỚC`;
              return `<option value="${escapeHtml(
                recipe.name,
              )}">${escapeHtml(recipe.name + health)}</option>`;
            },
          )
          .join('')
      : '<option value="">Chưa có recipe</option>';
    if (recipeNames.includes(previous)) {
      elements.recipeSelect.value = previous;
    }

    elements.recordStart.disabled = Boolean(
      status.recorder || status.operation,
    );
    elements.recordStop.disabled = !status.recorder;
    elements.replaySafe.disabled = Boolean(
      status.recorder || status.operation || !status.recipes.length,
    );
    elements.replayCommit.disabled = elements.replaySafe.disabled;
  } catch (error) {
    localLog('ERROR', `Không đọc được trạng thái app: ${error.message}`);
  }
}

elements.startChrome.addEventListener('click', () =>
  withButton(elements.startChrome, 'ĐANG MỞ...', () =>
    request('/api/chrome/start'),
  ),
);

elements.authCookie.addEventListener('click', () =>
  withButton(elements.authCookie, 'ĐANG NẠP...', () =>
    request('/api/auth'),
  ),
);

elements.recordStart.addEventListener('click', () =>
  withButton(elements.recordStart, 'ĐANG KHỞI TẠO...', () =>
    request('/api/record/start', {
      name: elements.recipeName.value.trim(),
    }),
  ),
);

elements.recordStop.addEventListener('click', () =>
  withButton(elements.recordStop, 'ĐANG LƯU...', () =>
    request('/api/record/stop'),
  ),
);

elements.replaySafe.addEventListener('click', () =>
  withButton(elements.replaySafe, 'ĐANG KIỂM TRA...', () =>
    request('/api/replay', {
      name: selectedRecipe(),
      commit: false,
      forceRepeat: false,
    }),
  ),
);

elements.replayCommit.addEventListener('click', () => {
  const name = selectedRecipe();
  const forceRepeat = elements.forceRepeat.checked;
  const warning = forceRepeat
    ? `Chạy lại side effect của "${name}" dù journal có thể đã ghi nhận?`
    : `Cho phép "${name}" upload/generate và tạo side effect thật?`;
  if (!window.confirm(warning)) {
    localLog('GUARD', 'Người dùng đã hủy Commit.');
    return;
  }
  void withButton(elements.replayCommit, 'ĐANG CHẠY...', () =>
    request('/api/replay', {
      name,
      commit: true,
      forceRepeat,
    }),
  );
});

elements.resetRegistry.addEventListener('click', () => {
  if (!window.confirm('Backup và reset toàn bộ locator đã ghi?')) {
    localLog('GUARD', 'Người dùng đã hủy reset registry.');
    return;
  }
  void withButton(elements.resetRegistry, 'ĐANG RESET...', () =>
    request('/api/registry/reset'),
  );
});

elements.clearLogs.addEventListener('click', () => {
  elements.logs.replaceChildren();
  localLog('INFO', 'Đã xóa log trên màn hình; log server không bị xóa.');
});

elements.batchRows.addEventListener('change', (event) => {
  const job = jobFromElement(event.target);
  if (!job) return;
  if (event.target.matches('.job-check')) {
    job.selected = event.target.checked;
    renderJobs();
    schedulePersist();
  }
});

elements.batchRows.addEventListener('input', (event) => {
  if (!event.target.matches('.prompt-box')) return;
  const job = jobFromElement(event.target);
  if (job) {
    job.prompt = event.target.value;
    schedulePersist();
  }
});

elements.batchRows.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const job = jobFromElement(button);
  if (!job) return;
  const action = button.dataset.action;
  if (action === 'reference' || action === 'import-ref') {
    const firstEmpty = Math.max(
      0,
      job.references.findIndex((reference) => !reference),
    );
    const slot =
      action === 'reference'
        ? Number(button.dataset.slot)
        : firstEmpty;
    if (action === 'reference' && job.references[slot]) {
      openReferenceModal(job, slot);
      return;
    }
    pendingReference = {
      jobId: job.id,
      slot,
    };
    elements.referenceFile.value = '';
    elements.referenceFile.click();
    return;
  }
  localLog('INFO', `[UI] ${action} · ${job.code}`);
  if (action === 'open-result') {
    const resultUrl =
      button.dataset.resultUrl ||
      job.results?.[0] ||
      (String(job.result || '').startsWith('/output-assets/')
        ? job.result
        : null);
    if (resultUrl) openResultModal(job, resultUrl);
    return;
  }
  if (action === 'retry') {
    job.status = 'waiting';
    job.progress = 0;
    job.selected = true;
    renderJobs();
    schedulePersist();
  }
});

if (elements.newWorkspace) {
  elements.newWorkspace.addEventListener('click', async () => {
    try {
      const result = await request('/api/batch/workspaces/new', {
        title: `Workspace ${workspaces.length + 1}`,
      });
      if (result.ok && result.workspace) {
        currentWorkspaceId = result.workspace.id;
        localStorage.setItem('currentWorkspaceId', currentWorkspaceId);
        await loadWorkspaces();
        await loadBatchState();
        renderJobs();
      }
    } catch (error) {
      localLog('ERROR', `Không tạo được workspace mới: ${error.message}`);
    }
  });
}

if (elements.workspaceTabs) {
  elements.workspaceTabs.addEventListener('click', async (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab) return;
    const id = tab.dataset.workspaceId;
    if (id && id !== currentWorkspaceId) {
      currentWorkspaceId = id;
      localStorage.setItem('currentWorkspaceId', currentWorkspaceId);
      renderWorkspaceTabs();
      await loadBatchState();
      renderJobs();
    }
  });

  elements.workspaceTabs.addEventListener('dblclick', async (event) => {
    const tab = event.target.closest('.workspace-tab');
    if (!tab) return;
    const id = tab.dataset.workspaceId;
    const workspace = workspaces.find((w) => w.id === id);
    if (!workspace) return;
    const newTitle = window.prompt('Đổi tên tab:', workspace.title);
    if (newTitle && newTitle.trim() !== workspace.title) {
      try {
        const response = await fetch(`/api/batch/workspaces/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Flow-Observer': '1',
          },
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (response.ok) {
          await loadWorkspaces();
        }
      } catch (error) {
        localLog('ERROR', `Lỗi đổi tên tab: ${error.message}`);
      }
    }
  });
}

elements.addRow.addEventListener('click', () => {
  const id = Math.max(0, ...jobs.map((job) => job.id)) + 1;
  jobs.push({
    id,
    code: `S${Math.floor((id - 1) / 3) + 1}.${((id - 1) % 3) + 1}`,
    selected: true,
    prompt: '',
    hasResult: false,
    results: [],
    progress: 0,
    runFolder: null,
    status: 'waiting',
  });
  renderJobs();
  schedulePersist();
  localLog('INFO', `[UI] Đã thêm job ${id}.`);
});

elements.selectAll.addEventListener('click', () => {
  const next = !jobs.every((job) => job.selected);
  jobs.forEach((job) => {
    job.selected = next;
  });
  renderJobs();
  schedulePersist();
  localLog('INFO', `[UI] ${next ? 'Chọn' : 'Bỏ chọn'} toàn bộ job.`);
});

elements.runBatch.addEventListener('click', async () => {
  const selected = selectedBatchJobs();
  if (!selected.length) {
    localLog('GUARD', 'Không có job nào được chọn.');
    return;
  }
  elements.runBatch.disabled = true;
  try {
    const result = await request('/api/batch/validate', {
      selectedIds: selected.map((job) => job.id),
      commit: true,
      workspaceId: currentWorkspaceId,
    });
    if (result.ready) {
      const summary = `${result.selected} job · ${elements.generationMode.value} · ${elements.modelSelect.value} · ${elements.aspectSelect.value} · ${elements.countSelect.value} · delay ${Number(elements.delaySelect.value) / 1000}s`;
      if (
        !window.confirm(
          `Chạy thật ${summary} trên Google Flow? Thao tác này sử dụng lượt tạo nội dung.`,
        )
      ) {
        localLog('GUARD', 'Người dùng đã hủy Batch Run.');
        return;
      }
      await request('/api/batch/run', {
        selectedIds: selected.map((job) => job.id),
        commit: true,
        workspaceId: currentWorkspaceId,
      });
      await loadBatchState();
      renderJobs();
    }
  } finally {
    elements.runBatch.disabled = false;
  }
});

elements.testBatch.addEventListener('click', async () => {
  const selected = selectedBatchJobs();
  if (!selected.length) {
    localLog('GUARD', 'Không có job nào được chọn.');
    return;
  }
  elements.testBatch.disabled = true;
  try {
    const validation = await request('/api/batch/validate', {
      selectedIds: selected.map((job) => job.id),
      commit: false,
      workspaceId: currentWorkspaceId,
    });
    if (!validation.ready) return;
    await request('/api/batch/run', {
      selectedIds: selected.map((job) => job.id),
      commit: false,
      workspaceId: currentWorkspaceId,
    });
  } finally {
    elements.testBatch.disabled = false;
  }
});

elements.runErrors.addEventListener('click', () => {
  const errors = jobs.filter((job) => job.status === 'error');
  jobs.forEach((job) => {
    job.selected = job.status === 'error';
  });
  renderJobs();
  schedulePersist();
  localLog('INFO', `[UI] Đã chọn ${errors.length} job lỗi để chạy lại.`);
});

const FLOW_CONFIG = {
  Image: {
    models: ["Nano Banana Pro"],
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    counts: ["1x", "x2", "x3", "x4"]
  },
  Video: {
    models: ["Omni Flash", "Veo 3.1 - Lite", "Veo 3.1 - Fast", "Veo 3.1 - Quality"],
    ratios: ["9:16", "16:9"],
    counts: ["1x", "x2", "x3", "x4"],
    durations: ["4s", "6s", "8s", "10s"],
    inputTypes: ["Khung hình", "Thành phần"]
  }
};

function updateConfigUI() {
  const mode = elements.generationMode.value;
  const config = FLOW_CONFIG[mode] || FLOW_CONFIG.Image;
  
  // Model Select
  const currentModel = elements.modelSelect.value;
  elements.modelSelect.innerHTML = config.models.map(m => `<option value="${m}">${m}</option>`).join('');
  if (config.models.includes(currentModel)) {
    elements.modelSelect.value = currentModel;
  } else {
    elements.modelSelect.value = config.models[0];
  }

  if (mode === 'Video') {
    elements.inputTypeSelect.style.display = 'inline-block';
    elements.durationSelect.style.display = 'inline-block';
  } else {
    elements.inputTypeSelect.style.display = 'none';
    elements.durationSelect.style.display = 'none';
  }
}

for (const select of [
  elements.generationMode,
  elements.inputTypeSelect,
  elements.modelSelect,
  elements.durationSelect,
  elements.aspectSelect,
  elements.countSelect,
  elements.delaySelect,
]) {
  select.addEventListener('change', () => {
    if (select === elements.generationMode) {
       updateConfigUI();
    }
    localLog('INFO', `[UI] ${select.getAttribute('aria-label')}: ${select.value}`);
    schedulePersist();
  });
}

// Initial UI config
updateConfigUI();

elements.exportPrompts.addEventListener('click', () => {
  const rows = selectedBatchJobs().length ? selectedBatchJobs() : jobs;
  downloadText(
    'flow-prompts.txt',
    rows.map((job) => `[${job.code}]\n${job.prompt}`).join('\n\n'),
  );
  localLog('SUCCESS', `[UI] Đã xuất ${rows.length} prompt.`);
});

elements.exportSrt.addEventListener('click', () => {
  const rows = selectedBatchJobs().length ? selectedBatchJobs() : jobs;
  const srt = rows
    .map((job, index) => {
      const start = String(index * 5).padStart(2, '0');
      const end = String(index * 5 + 5).padStart(2, '0');
      return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\n${
        job.prompt
      }`;
    })
    .join('\n\n');
  downloadText('flow-prompts.srt', srt);
  localLog('SUCCESS', `[UI] Đã xuất SRT cho ${rows.length} job.`);
});

elements.deleteRows.addEventListener('click', () => {
  const count = selectedBatchJobs().length;
  if (!count) {
    localLog('GUARD', 'Không có job được chọn để xóa.');
    return;
  }
  if (!window.confirm(`Xóa ${count} job đang chọn?`)) return;
  jobs = jobs.filter((job) => !job.selected);
  renderJobs();
  schedulePersist();
  localLog('GUARD', `[UI] Đã xóa ${count} job khỏi bảng.`);
});

elements.clearRows.addEventListener('click', () => {
  if (!jobs.length || !window.confirm('Xóa toàn bộ job trong bảng?')) return;
  const count = jobs.length;
  jobs = [];
  renderJobs();
  schedulePersist();
  localLog('GUARD', `[UI] Đã xóa toàn bộ ${count} job.`);
});

elements.referenceFile.addEventListener('change', async () => {
  const file = elements.referenceFile.files?.[0];
  const target = pendingReference;
  pendingReference = null;
  if (!file || !target) return;
  if (file.size > 8 * 1024 * 1024) {
    localLog('GUARD', 'Reference vượt quá giới hạn 8 MB.');
    return;
  }
  try {
    localLog(
      'INFO',
      `[UI] Đang lưu reference cho job ${target.jobId}, slot ${
        target.slot + 1
      }.`,
    );
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const dataBase64 = String(dataUrl).split(',')[1];
    const result = await request('/api/batch/reference', {
      jobId: target.jobId,
      slot: target.slot,
      fileName: file.name,
      mimeType: file.type,
      dataBase64,
    });
    const job = jobs.find((candidate) => candidate.id === target.jobId);
    if (job) {
      job.references[target.slot] = result.url;
      renderJobs();
      schedulePersist();
    }
  } catch (error) {
    if (!error.serverReported) {
      localLog('ERROR', `Không lưu được reference: ${error.message}`);
    }
  }
});

elements.closeImageModal.addEventListener('click', closeReferenceModal);
elements.imageModal.addEventListener('click', (event) => {
  if (event.target === elements.imageModal) closeReferenceModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.imageModal.hidden) {
    closeReferenceModal();
  }
});

elements.replaceReference.addEventListener('click', () => {
  if (!modalReference) return;
  pendingReference = { ...modalReference };
  closeReferenceModal();
  elements.referenceFile.value = '';
  elements.referenceFile.click();
});

elements.deleteReference.addEventListener('click', async () => {
  if (!modalReference) return;
  const target = { ...modalReference };
  const job = jobs.find((candidate) => candidate.id === target.jobId);
  if (
    !window.confirm(
      `Xóa Reference ${target.slot + 1} của ${job?.code || `job ${target.jobId}`} khỏi app và ổ đĩa local?`,
    )
  ) {
    localLog('GUARD', 'Người dùng đã hủy xóa reference.');
    return;
  }
  elements.deleteReference.disabled = true;
  try {
    await request('/api/batch/reference/delete', target);
    if (job) {
      job.references[target.slot] = null;
      renderJobs();
    }
    closeReferenceModal();
  } finally {
    elements.deleteReference.disabled = false;
  }
});

elements.topTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchView(tab.dataset.view);
    if (tab.dataset.view === 'timeline') {
      void loadFlowSessions().catch(() => {});
    }
  });
});

elements.newFlowSession.addEventListener('click', () =>
  withButton(elements.newFlowSession, '…', async () => {
    await request('/api/flow/session/new');
    await loadFlowSessions();
  }),
);

elements.flowSessions.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-session-id]');
  if (!button) return;
  await request('/api/flow/session/activate', {
    sessionId: button.dataset.sessionId,
  });
  await loadFlowSessions();
});

for (const input of [
  elements.directorProvider,
  elements.styleAnalyzer,
  elements.styleDna,
  elements.filmType,
  elements.scriptLanguage,
  elements.characterAnalyzer,
  elements.characterDna,
  elements.preserveScript,
  elements.storyMode,
  elements.allowText,
  elements.targetSceneSeconds,
  elements.storyInput,
  elements.masterJson,
]) {
  input.addEventListener('input', () => {
    if (input === elements.masterJson) updateMasterStats();
    if (input === elements.directorProvider) {
      elements.directorProviderStatus.textContent =
        input.value === 'manual-ai-studio'
          ? 'MANUAL AI STUDIO'
          : 'LOCAL DRAFT';
    }
    scheduleStudioPersist();
  });
  input.addEventListener('change', scheduleStudioPersist);
}

elements.styleReferences.addEventListener('change', () => {
  const files = [...(elements.styleReferences.files || [])];
  if (files.length > 6) {
    elements.styleReferences.value = '';
    elements.styleReferenceCount.textContent =
      'Tối đa 6 ảnh; hãy chọn lại.';
    localLog('GUARD', 'Visual DNA chỉ nhận tối đa 6 ảnh tham chiếu.');
    return;
  }
  elements.styleReferenceCount.textContent = files.length
    ? `${files.length}/6 · ${files.map((file) => file.name).join(', ')}`
    : 'Chưa chọn ảnh';
});

elements.characterReference.addEventListener('change', () => {
  const file = elements.characterReference.files?.[0];
  elements.characterReferenceName.textContent = file
    ? file.name
    : 'Chưa chọn ảnh';
});

elements.copyStyleAnalyzer.addEventListener('click', () =>
  copyText(elements.styleAnalyzer.value, 'prompt Visual DNA'),
);

elements.copyCharacterAnalyzer.addEventListener('click', () =>
  copyText(elements.characterAnalyzer.value, 'prompt Character DNA'),
);

elements.copyMasterJson.addEventListener('click', () =>
  copyText(elements.masterJson.value, 'Master JSON'),
);

elements.openAiStudio.addEventListener('click', () => {
  window.open(
    'https://aistudio.google.com/prompts/new_chat',
    '_blank',
    'noopener,noreferrer',
  );
  localLog(
    'INFO',
    'Đã mở Google AI Studio; dùng nút Copy master-instruction để yêu cầu JSON.',
  );
});

elements.copyDirectorInstruction.addEventListener('click', async () => {
  const result = await request(
    '/api/script-studio/instruction',
    collectScriptStudio(),
  );
  await copyText(result.instruction, 'master-instruction');
});

elements.compileDirector.addEventListener('click', () =>
  withButton(
    elements.compileDirector,
    'ĐANG BĂM SCENE...',
    async () => {
      if (elements.directorProvider.value === 'manual-ai-studio') {
        window.open(
          'https://aistudio.google.com/prompts/new_chat',
          '_blank',
          'noopener,noreferrer',
        );
        const result = await request(
          '/api/script-studio/instruction',
          collectScriptStudio(),
        );
        await copyText(
          result.instruction,
          'master-instruction cho AI Studio',
        );
        localLog(
          'GUARD',
          'AI Studio đã mở. Dán instruction, sau đó dán JSON trả về vào Master JSON để kiểm tra và chạy Flow.',
        );
        return result;
      }
      const result = await request(
        '/api/script-studio/compile',
        collectScriptStudio(),
      );
      elements.masterJson.value = JSON.stringify(
        result.master,
        null,
        2,
      );
      updateMasterStats();
      localLog(
        'SUCCESS',
        `Director đã tạo ${result.master.scenes.length} scene.`,
      );
      return result;
    },
  ),
);

elements.runMasterFlow.addEventListener('click', async () => {
  let master;
  try {
    master = JSON.parse(elements.masterJson.value);
  } catch {
    localLog('GUARD', 'Master JSON chưa hợp lệ.');
    return;
  }
  const scenes = Array.isArray(master.scenes) ? master.scenes : [];
  const promptCount = scenes.reduce(
    (total, scene) =>
      total + (Array.isArray(scene.prompts) ? scene.prompts.length : 0),
    0,
  );
  if (!promptCount) {
    localLog('GUARD', 'Master JSON chưa có prompt để chạy.');
    return;
  }
  if (
    !window.confirm(
      `Tạo tab/project Flow mới và chạy ${promptCount} prompt thuộc ${scenes.length} scene? Thao tác này sử dụng lượt tạo nội dung.`,
    )
  ) {
    localLog('GUARD', 'Người dùng đã hủy Master Flow Run.');
    return;
  }

  elements.runMasterFlow.disabled = true;
  elements.runMasterFlow.textContent = 'ĐANG CHẠY FLOW...';
  try {
    await request('/api/script-studio/run-flow', {
      commit: true,
      newTab: true,
      masterJson: elements.masterJson.value,
      settings: {
        model: elements.modelSelect.value,
        aspect: elements.aspectSelect.value,
        count: elements.countSelect.value,
        submitDelayMs: Number(elements.delaySelect.value),
      },
    });
    await loadBatchState();
    renderJobs();
    await loadFlowSessions();
    switchView('timeline');
  } finally {
    elements.runMasterFlow.disabled = false;
    elements.runMasterFlow.textContent =
      '▶ Kích hoạt chạy AI Studio FLOW';
  }
});

const events = new EventSource('/events');
events.onmessage = (message) => {
  const event = JSON.parse(message.data);
  const isCurrentWorkspace = !event.data?.workspaceId || event.data.workspaceId === currentWorkspaceId;
  
  if (isCurrentWorkspace) {
    appendLog(event);
  }
  
  if (event.data?.refreshWorkspaces) {
    void loadWorkspaces().catch(() => {});
  }
  if (event.data?.refreshBatch && isCurrentWorkspace) {
    void loadBatchState().then(renderJobs).catch(() => {});
  }
  if (event.data?.refreshSessions) {
    void loadFlowSessions().catch(() => {});
  }
  if (event.data?.jobId && event.data?.status && isCurrentWorkspace) {
    const job = jobs.find(
      (candidate) => candidate.id === Number(event.data.jobId),
    );
    if (job) {
      Object.assign(job, {
        status: event.data.status,
        progress: Number(event.data.progress || 0),
        result: event.data.result || job.result || null,
        results: Array.isArray(event.data.results)
          ? event.data.results
          : job.results || [],
        runFolder: event.data.runFolder || job.runFolder || null,
        selected:
          typeof event.data.selected === 'boolean'
            ? event.data.selected
            : job.selected,
      });
      job.hasResult = Boolean(job.result || job.results?.length);
      renderJobs();
    }
  }
};
events.onerror = () =>
  localLog('ERROR', 'Mất kết nối Observer Log; đang tự kết nối lại.');

localLog('INFO', 'Dashboard đã sẵn sàng. Đang đồng bộ trạng thái...');
try {
  await loadWorkspaces();
  await loadBatchState();
  localLog('SUCCESS', `Đã tải batch project với ${jobs.length} job.`);
} catch (error) {
  localLog('ERROR', error.message);
}
try {
  await loadScriptStudioState();
} catch (error) {
  localLog('ERROR', error.message);
}
await loadFlowSessions().catch(() => {});
renderJobs();
await refreshStatus();
setInterval(refreshStatus, 3_000);
