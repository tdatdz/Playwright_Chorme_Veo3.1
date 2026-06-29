import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const NEGATIVE_ALERT =
  /\b(error|failed|failure|quota|limit|blocked|denied|try again|unavailable)\b|lỗi|thất bại|hết lượt|giới hạn|bị chặn|thử lại|không khả dụng/i;
const DESTRUCTIVE =
  /\b(delete|remove|trash|discard|clear all)\b|xóa|xoá|bỏ|thùng rác/i;
const SIDE_EFFECT =
  /\b(generate|create|submit|send|publish|render|download|new project)\b|tạo|gửi|xuất|tải xuống|dự án mới/i;
const BLOCKING_SELECTOR =
  '[role="alertdialog"],[aria-modal="true"],[role="dialog"],[role="menu"],[role="listbox"]';

export function routeKind(url) {
  try {
    return new URL(url).pathname.includes('/project/')
      ? 'project'
      : 'flow-home';
  } catch {
    return 'unknown';
  }
}

export function inferStepRisk(step, control) {
  if (step.risk) return step.risk;
  if (step.action === 'upload') return 'upload';
  if (step.action !== 'click') return null;
  const fingerprint = control?.fingerprint || {};
  const description = [
    fingerprint.name,
    fingerprint.text,
    fingerprint.ariaLabel,
    fingerprint.title,
  ]
    .filter(Boolean)
    .join(' ');
  if (DESTRUCTIVE.test(description)) return 'destructive';
  if (SIDE_EFFECT.test(description)) return 'side_effect';
  return null;
}

export function assertSafeStart(page, keyframe) {
  if (
    keyframe.startRoute &&
    routeKind(page.url()) !== keyframe.startRoute
  ) {
    throw new Error(
      `Wrong Flow state: recipe requires "${keyframe.startRoute}", current state is "${routeKind(
        page.url(),
      )}".`,
    );
  }
}

export function assertSideEffectsAllowed(
  keyframe,
  registry,
  { allowSideEffects = false } = {},
) {
  const risky = keyframe.steps
    .map((step, index) => ({
      index,
      control: step.control,
      risk: inferStepRisk(step, registry.controls[step.control]),
    }))
    .filter((item) => item.risk);

  if (risky.length > 0 && !allowSideEffects) {
    const summary = risky
      .map(
        (item) =>
          `#${item.index + 1} ${item.control} (${item.risk})`,
      )
      .join(', ');
    throw new Error(
      `Safety lock blocked ${risky.length} risky steps: ${summary}. Review the recipe, then run again with "--commit".`,
    );
  }
}

export async function assertFileIsUsable(filePath) {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Upload file does not exist: ${resolved}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Upload path is not a non-empty file: ${resolved}`);
  }
}

export async function readControlState(locator) {
  return locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    type: (element.getAttribute('type') || '').toLowerCase(),
    role: element.getAttribute('role'),
    disabled:
      element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
    checked:
      'checked' in element ? Boolean(element.checked) : null,
    ariaSelected: element.getAttribute('aria-selected'),
    ariaPressed: element.getAttribute('aria-pressed'),
    value:
      element.isContentEditable
        ? element.innerText
        : 'value' in element
          ? element.value
          : null,
  }));
}

export async function observeBeforeAction(
  locator,
  { quietMs = 280, maxWaitMs = 2_500 } = {},
) {
  const observation = await locator.evaluate(
    (element, options) =>
      new Promise((resolve) => {
        const root =
          element.closest(
            '[role="dialog"],[role="menu"],[role="listbox"],form',
          ) ||
          element.parentElement ||
          element;
        let mutationCount = 0;
        let quietTimer;
        let maxTimer;
        let finished = false;

        const targetName =
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder') ||
          (element.innerText || element.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100) ||
          element.tagName.toLowerCase();

        const finish = (stable) => {
          if (finished) return;
          finished = true;
          observer.disconnect();
          clearTimeout(quietTimer);
          clearTimeout(maxTimer);
          resolve({
            stable,
            connected: element.isConnected,
            mutationCount,
            targetName,
            targetRole:
              element.getAttribute('role') ||
              element.tagName.toLowerCase(),
            ariaBusy:
              root.getAttribute?.('aria-busy') === 'true' ||
              element.getAttribute('aria-busy') === 'true',
          });
        };

        const armQuietWindow = () => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(
            () => finish(true),
            options.quietMs,
          );
        };

        const observer = new MutationObserver((records) => {
          mutationCount += records.length;
          armQuietWindow();
        });
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            'aria-busy',
            'aria-disabled',
            'aria-selected',
            'aria-pressed',
            'disabled',
            'hidden',
          ],
        });
        armQuietWindow();
        maxTimer = setTimeout(
          () => finish(false),
          options.maxWaitMs,
        );
      }),
    { quietMs, maxWaitMs },
  );

  if (!observation.connected) {
    throw new Error('Target changed or disappeared while being observed.');
  }
  if (!observation.stable || observation.ariaBusy) {
    throw new Error(
      `UI is still changing near "${observation.targetName}"; click was blocked.`,
    );
  }
  return observation;
}

export async function stepIsAlreadySatisfied(locator, step, value) {
  const state = await readControlState(locator);
  if (state.disabled) {
    throw new Error(`Target control is disabled: ${step.control}`);
  }
  if (step.action === 'fill' && state.value === String(value)) return true;
  if (step.action === 'select' && state.value === String(value)) return true;
  if (step.action === 'check' && state.checked === true) return true;
  if (step.action === 'uncheck' && state.checked === false) return true;

  if (step.action === 'click') {
    if (step.desiredState === 'checked' && state.checked === true) return true;
    if (step.desiredState === 'unchecked' && state.checked === false) return true;
    if (
      step.desiredState === 'selected' &&
      state.ariaSelected === 'true'
    ) {
      return true;
    }
    if (
      step.desiredState === 'pressed' &&
      state.ariaPressed === 'true'
    ) {
      return true;
    }
    if (
      step.desiredState === 'not-pressed' &&
      state.ariaPressed === 'false'
    ) {
      return true;
    }
    if (state.role === 'tab' && state.ariaSelected === 'true') return true;
  }
  return false;
}

async function firstVisibleText(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      return (await item.innerText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
    }
  }
  return null;
}

export async function assertNoUnexpectedUi(
  page,
  target,
  { checkDialogs = true } = {},
) {
  const targetInsideDialog = await target
    .evaluate(
      (element, selector) => Boolean(element.closest(selector)),
      BLOCKING_SELECTOR,
    )
    .catch(() => false);

  if (checkDialogs && !targetInsideDialog) {
    const dialogText = await firstVisibleText(
      page.locator(BLOCKING_SELECTOR),
    );
    if (dialogText) {
      throw new Error(
        `Unexpected dialog is blocking the workflow: "${dialogText}"`,
      );
    }
  }

  const alerts = page.locator('[role="alert"]');
  const count = await alerts.count();
  for (let index = 0; index < count; index += 1) {
    const alert = alerts.nth(index);
    if (!(await alert.isVisible().catch(() => false))) continue;
    const text = (await alert.innerText().catch(() => '')).trim();
    if (text && NEGATIVE_ALERT.test(text)) {
      throw new Error(`Flow reported a problem: "${text.slice(0, 240)}"`);
    }
  }
}

export async function saveFailureArtifact(page, details) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.resolve('artifacts', 'failures');
  const imagePath = path.join(directory, `${stamp}.png`);
  const jsonPath = path.join(directory, `${stamp}.json`);
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: imagePath, fullPage: false }).catch(() => {});
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        url: page.url(),
        ...details,
      },
      null,
      2,
    )}\n`,
  );
  return { imagePath, jsonPath };
}

function journalName(keyframe) {
  return String(keyframe.id || 'recipe')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 80);
}

export async function beginRiskyAction(
  keyframe,
  step,
  variables,
  { allowRepeat = false } = {},
) {
  const directory = path.resolve('artifacts', 'journals');
  const journalPath = path.join(directory, `${journalName(keyframe)}.json`);
  let journal = { schemaVersion: 1, entries: [] };
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const signature = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        recipe: keyframe.id,
        control: step.control,
        action: step.action,
        variables,
      }),
    )
    .digest('hex');
  const previous = journal.entries.find(
    (entry) => entry.signature === signature,
  );
  if (previous && !allowRepeat) {
    throw new Error(
      `Duplicate side effect blocked: ${step.control} was previously "${previous.status}" at ${previous.startedAt}. Inspect Flow, then use "--force-repeat" only if another action is intentional.`,
    );
  }

  const entry = {
    signature,
    control: step.control,
    action: step.action,
    status: 'pending',
    startedAt: new Date().toISOString(),
  };
  journal.entries = journal.entries.filter(
    (candidate) => candidate.signature !== signature,
  );
  journal.entries.push(entry);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    journalPath,
    `${JSON.stringify(journal, null, 2)}\n`,
  );
  return { journalPath, signature };
}

export async function completeRiskyAction(token) {
  if (!token) return;
  const journal = JSON.parse(await fs.readFile(token.journalPath, 'utf8'));
  const entry = journal.entries.find(
    (candidate) => candidate.signature === token.signature,
  );
  if (entry) {
    entry.status = 'completed';
    entry.completedAt = new Date().toISOString();
    await fs.writeFile(
      token.journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
    );
  }
}
