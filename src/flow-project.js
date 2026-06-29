import {
  assertNoUnexpectedUi,
  observeBeforeAction,
} from './safety.js';
import {
  clearActionIndicator,
  showActionIndicator,
} from './indicator.js';

export const FLOW_HOME_URL = 'https://labs.google/fx/vi/tools/flow';

export function flowProjectId(pageOrUrl) {
  const url =
    typeof pageOrUrl === 'string' ? pageOrUrl : pageOrUrl?.url?.();
  const match = String(url || '').match(/\/flow\/project\/([^/?#]+)/);
  return match?.[1] || null;
}

async function visibleUnique(locator, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const count = await locator.count();
    const visible = [];
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) visible.push(item);
    }
    if (visible.length === 1) return visible[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label}: không tìm thấy đúng một control hiển thị.`);
}

async function emit(onEvent, level, message, data = {}) {
  await onEvent({ level, message, ...data });
}

export async function ensureFlowProject(
  page,
  { onEvent = async () => {}, createIfMissing = true } = {},
) {
  if (flowProjectId(page)) {
    await visibleUnique(
      page.locator('[role="textbox"][contenteditable="true"]'),
      'Flow project composer',
    );
    await emit(onEvent, 'GUARD', 'Tab Flow đã ở trong project, không tạo lại.');
    return page;
  }

  if (!page.url().includes('/tools/flow')) {
    await emit(onEvent, 'ACTION', 'Mở trang chủ Google Flow.');
    await page.goto(FLOW_HOME_URL, { waitUntil: 'domcontentloaded' });
  }
  if (!createIfMissing) {
    throw new Error('Flow đang ở trang chủ và chưa có project được mở.');
  }

  const newProject = await visibleUnique(
    page
      .locator('button')
      .filter({ hasText: /Dự án mới|New project/i }),
    'Dự án mới',
  );
  const observation = await observeBeforeAction(newProject);
  await emit(onEvent, 'OBSERVE', 'UI ổn định tại nút Dự án mới.', {
    mutations: observation.mutationCount,
  });
  await assertNoUnexpectedUi(page, newProject);
  await showActionIndicator(page, newProject, {
    action: 'click',
    control: 'Dự án mới',
    previewMs: 600,
  });
  await emit(onEvent, 'ACTION', 'Click Dự án mới.');
  try {
    await newProject.click();
  } finally {
    await clearActionIndicator(page);
  }
  await page.waitForURL(/\/flow\/project\/[^/?#]+/, {
    timeout: 45_000,
    waitUntil: 'domcontentloaded',
  });
  await visibleUnique(
    page.locator('[role="textbox"][contenteditable="true"]'),
    'Flow project composer',
  );
  await emit(
    onEvent,
    'SUCCESS',
    `Project Flow đã sẵn sàng: ${flowProjectId(page)}`,
  );
  return page;
}

export async function createFlowProjectTab(
  browser,
  { onEvent = async () => {} } = {},
) {
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome automation chưa có browser context.');
  const page = await context.newPage();
  await emit(onEvent, 'ACTION', 'Mở tab Flow mới.');
  await page.goto(FLOW_HOME_URL, { waitUntil: 'domcontentloaded' });
  return ensureFlowProject(page, { onEvent, createIfMissing: true });
}

export function listFlowProjectPages(browser) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && flowProjectId(page));
}
