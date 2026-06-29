import fs from 'node:fs/promises';
import path from 'node:path';
import {
  clearActionIndicator,
  showActionIndicator,
} from './indicator.js';
import { loadRegistry } from './registry.js';
import {
  assertFileIsUsable,
  assertNoUnexpectedUi,
  assertSafeStart,
  assertSideEffectsAllowed,
  beginRiskyAction,
  completeRiskyAction,
  inferStepRisk,
  observeBeforeAction,
  saveFailureArtifact,
  stepIsAlreadySatisfied,
} from './safety.js';

function interpolate(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (_match, key) => {
    if (!(key in variables)) {
      throw new Error(`Missing keyframe variable: ${key}`);
    }
    return String(variables[key]);
  });
}

function frameForControl(page, control) {
  if (!control.frameUrl || control.frameUrl === page.url()) return page;
  return (
    page.frames().find((frame) => frame.url() === control.frameUrl) || page
  );
}

function candidateLocators(scope, fingerprint) {
  const candidates = [];
  if (fingerprint.testId) {
    const escaped = fingerprint.testId.replace(/"/g, '\\"');
    candidates.push(
      scope.locator(
        `[data-testid="${escaped}"],[data-test="${escaped}"],[data-qa="${escaped}"]`,
      ),
    );
  }
  if (fingerprint.role && fingerprint.name) {
    candidates.push(
      scope.getByRole(fingerprint.role, {
        name: fingerprint.name,
        exact: true,
      }),
    );
  }
  if (fingerprint.placeholder) {
    candidates.push(
      scope.getByPlaceholder(fingerprint.placeholder, { exact: true }),
    );
  }
  if (fingerprint.title) {
    candidates.push(scope.getByTitle(fingerprint.title, { exact: true }));
  }
  if (fingerprint.ariaLabel) {
    const escaped = fingerprint.ariaLabel.replace(/"/g, '\\"');
    candidates.push(scope.locator(`[aria-label="${escaped}"]`));
  }
  if (fingerprint.text && ['button', 'link', 'tab', 'option'].includes(
    fingerprint.role,
  )) {
    candidates.push(scope.getByText(fingerprint.text, { exact: true }));
  }
  if (fingerprint.css) candidates.push(scope.locator(fingerprint.css));
  return candidates;
}

async function visibleMatches(locator) {
  const count = await locator.count();
  const matches = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      matches.push(candidate);
    }
  }
  return matches;
}

async function closestToAnchor(matches, anchor) {
  if (!anchor || matches.length < 2) return matches[0];
  let best = null;
  for (const locator of matches) {
    const box = await locator.boundingBox();
    if (!box) continue;
    const viewport = anchor.viewport;
    const x = (box.x + box.width / 2) / viewport.width;
    const y = (box.y + box.height / 2) / viewport.height;
    const distance = Math.hypot(x - anchor.x, y - anchor.y);
    if (!best || distance < best.distance) best = { locator, distance };
  }
  return best?.locator || matches[0];
}

async function resolveControl(page, control) {
  const scope = frameForControl(page, control);
  for (const locator of candidateLocators(scope, control.fingerprint)) {
    const matches = await visibleMatches(locator);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      return closestToAnchor(matches, control.visualAnchor);
    }
  }
  throw new Error(`Control not found: ${control.key}`);
}

async function perform(page, locator, step, value) {
  switch (step.action) {
    case 'click':
      await locator.click();
      break;
    case 'fill':
      await locator.fill(value);
      break;
    case 'press':
      await locator.press(value);
      break;
    case 'check':
      await locator.check();
      break;
    case 'uncheck':
      await locator.uncheck();
      break;
    case 'select':
      await locator.selectOption(value);
      break;
    case 'upload':
      if (
        await locator
          .evaluate((element) => element.matches('input[type="file"]'))
          .catch(() => false)
      ) {
        await locator.setInputFiles(path.resolve(value));
        break;
      }
      {
        const nestedInput = locator.locator('input[type="file"]');
        if ((await nestedInput.count()) > 0) {
          await nestedInput.first().setInputFiles(path.resolve(value));
          break;
        }
        const chooserPromise = page.waitForEvent('filechooser', {
          timeout: 5_000,
        });
        await locator.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(path.resolve(value));
      }
      break;
    case 'waitVisible':
      await locator.waitFor({ state: 'visible' });
      break;
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

export async function runKeyframe(
  page,
  keyframePath,
  {
    allowSideEffects = false,
    allowRepeatSideEffects = false,
    onEvent = () => {},
  } = {},
) {
  const keyframe = JSON.parse(await fs.readFile(keyframePath, 'utf8'));
  const registry = await loadRegistry();
  const variables = keyframe.variables || {};
  const results = [];
  const emit = async (event) => {
    await onEvent({
      at: new Date().toISOString(),
      recipe: keyframe.id || path.basename(keyframePath),
      ...event,
    });
  };

  if (
    keyframe.urlIncludes &&
    !page.url().includes(keyframe.urlIncludes)
  ) {
    throw new Error(
      `Wrong page. Expected URL containing "${keyframe.urlIncludes}".`,
    );
  }
  assertSafeStart(page, keyframe);

  const missingControls = [
    ...new Set(
      keyframe.steps
        .filter(
          (step) =>
            step.control &&
            !step.optional &&
            !registry.controls[step.control],
        )
        .map((step) => step.control),
    ),
  ];
  if (missingControls.length > 0) {
    throw new Error(
      [
        `${missingControls.length} controls have not been trained:`,
        missingControls.join(', '),
        'Run "npm run train:keyframe" before running this keyframe.',
      ].join(' '),
    );
  }
  assertSideEffectsAllowed(keyframe, registry, { allowSideEffects });
  await emit({
    type: 'start',
    totalSteps: keyframe.steps.length,
    allowSideEffects,
  });

  for (const [index, step] of keyframe.steps.entries()) {
    if (step.action === 'sleep') {
      const milliseconds = Number(interpolate(step.value, variables));
      await emit({ type: 'wait', index, milliseconds });
      await page.waitForTimeout(milliseconds);
      results.push({ index, action: step.action, status: 'ok' });
      continue;
    }

    const control = registry.controls[step.control];
    if (!control) {
      const message = `Control has not been trained: ${step.control}`;
      if (step.optional) {
        results.push({ index, control: step.control, status: 'skipped' });
        continue;
      }
      throw new Error(message);
    }

    try {
      await emit({
        type: 'resolve',
        index,
        control: step.control,
        action: step.action,
      });
      const value = interpolate(step.value, variables);
      if (step.action === 'upload') {
        await assertFileIsUsable(value);
      }
      const locator = await resolveControl(page, control);
      const observation = await observeBeforeAction(locator);
      await emit({
        type: 'observe',
        index,
        control: step.control,
        target: observation.targetName,
        role: observation.targetRole,
        mutations: observation.mutationCount,
      });
      await assertNoUnexpectedUi(page, locator);
      if (await stepIsAlreadySatisfied(locator, step, value)) {
        await emit({
          type: 'guard',
          index,
          control: step.control,
          message: 'Trạng thái đã đúng, bỏ qua click lặp.',
        });
        results.push({
          index,
          control: step.control,
          status: 'already-satisfied',
        });
        continue;
      }
      const risk = inferStepRisk(step, control);
      const riskToken = ['side_effect', 'destructive'].includes(risk)
        ? await beginRiskyAction(keyframe, step, variables, {
            allowRepeat: allowRepeatSideEffects,
          })
        : null;
      await showActionIndicator(page, locator, step);
      await emit({
        type: 'action',
        index,
        control: step.control,
        action: step.action,
        risk,
      });
      await perform(page, locator, step, value);
      await completeRiskyAction(riskToken);
      await clearActionIndicator(page);
      await page.waitForTimeout(250);
      await assertNoUnexpectedUi(page, locator, { checkDialogs: false });
      await emit({
        type: 'success',
        index,
        control: step.control,
        action: step.action,
      });
      results.push({ index, control: step.control, status: 'ok' });
    } catch (error) {
      await clearActionIndicator(page);
      await emit({
        type: 'error',
        index,
        control: step.control,
        action: step.action,
        message: error.message,
      });
      if (!step.optional) {
        const failure = await saveFailureArtifact(page, {
          recipe: keyframe.id || path.basename(keyframePath),
          stepIndex: index,
          control: step.control,
          action: step.action,
          error: error.message,
        });
        throw new Error(
          `${error.message} Safety snapshot: ${failure.imagePath}`,
        );
      }
      results.push({
        index,
        control: step.control,
        status: 'skipped',
        reason: error.message,
      });
    }
  }

  return results;
}
