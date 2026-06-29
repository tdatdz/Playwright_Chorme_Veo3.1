import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveControl } from './registry.js';
import { inferStepRisk, routeKind } from './safety.js';

const BINDING_NAME = '__flowRecorderRecord';
const FLOW_URL_FRAGMENT = 'labs.google/fx/vi/tools/flow';

function assertRecipeName(name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name || '')) {
    throw new Error(
      'Recipe name may only contain letters, numbers, dot, underscore, and dash.',
    );
  }
}

function slug(value) {
  return String(value || 'control')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'control';
}

function keyFor(payload) {
  const fingerprint = payload.fingerprint;
  const signature = JSON.stringify({
    role: fingerprint.role,
    name: fingerprint.name,
    testId: fingerprint.testId,
    placeholder: fingerprint.placeholder,
    title: fingerprint.title,
    css: fingerprint.css,
  });
  const hash = crypto
    .createHash('sha1')
    .update(signature)
    .digest('hex')
    .slice(0, 8);
  return `recorded.${slug(fingerprint.role || fingerprint.tag)}.${slug(
    fingerprint.name || fingerprint.placeholder || fingerprint.text,
  )}.${hash}`;
}

export async function installRecorder(page, recipeName, onRecorded = () => {}) {
  assertRecipeName(recipeName);
  const recipePath = path.resolve(
    'artifacts',
    'recipes',
    `${recipeName}.json`,
  );
  const recipe = {
    schemaVersion: 1,
    id: recipeName,
    urlIncludes: FLOW_URL_FRAGMENT,
    startRoute: routeKind(page.url()),
    recordedAt: new Date().toISOString(),
    variables: {
      startFrame: 'D:/replace/with/your-keyframe.png',
    },
    steps: [],
  };
  await fs.mkdir(path.dirname(recipePath), { recursive: true });
  await fs.writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);

  let queue = Promise.resolve();
  const persist = async () => {
    await fs.writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  };

  try {
    await page.exposeBinding(BINDING_NAME, async (_source, payload) => {
      queue = queue.then(async () => {
        if (!payload?.fingerprint || !payload?.action) return;
        const controlKey = keyFor(payload);
        const savedControl = await saveControl({
          key: controlKey,
          pageUrl: payload.pageUrl,
          frameUrl: payload.frameUrl,
          fingerprint: payload.fingerprint,
          visualAnchor: payload.visualAnchor,
          capturedAt: new Date().toISOString(),
          recorded: true,
        });

        const step = {
          control: controlKey,
          action: payload.action,
        };
        if (payload.desiredState) {
          step.desiredState = payload.desiredState;
        }
        const risk = inferStepRisk(step, savedControl);
        if (risk) step.risk = risk;
        if (payload.action === 'upload') {
          step.value = '${startFrame}';
        } else if (payload.value !== undefined) {
          step.value = payload.value;
        }

        const previous = recipe.steps.at(-1);
        if (
          step.action === 'fill' &&
          previous?.action === 'fill' &&
          previous.control === step.control
        ) {
          previous.value = step.value;
        } else if (
          !(
            step.action === 'click' &&
            previous?.action === 'click' &&
            previous.control === step.control
          )
        ) {
          recipe.steps.push(step);
        }
        await persist();
        onRecorded({
          number: recipe.steps.length,
          action: step.action,
          control: controlKey,
          name: payload.fingerprint.name,
        });
      });
      return queue;
    });
  } catch (error) {
    if (!String(error.message).includes('has been already registered')) {
      throw error;
    }
  }

  const injectFrame = async (frame) => {
    await frame
      .evaluate(({ bindingName, recipeName }) => {
        window.__flowRecorder?.cleanup?.();

        const state = {
          inputTimer: null,
          pendingInput: null,
        };
        const panel = document.createElement('div');
        panel.id = '__flow-recorder-panel';
        panel.textContent = `● RECORDING: ${recipeName} · Click và nhập liệu bình thường`;
        Object.assign(panel.style, {
          position: 'fixed',
          zIndex: '2147483647',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 14px',
          border: '1px solid #ef4444',
          borderRadius: '9px',
          background: 'rgba(69, 10, 10, .96)',
          color: '#fee2e2',
          font: '700 13px/1.3 system-ui, sans-serif',
          boxShadow: '0 8px 28px rgba(0,0,0,.4)',
          pointerEvents: 'none',
        });
        document.documentElement.appendChild(panel);

        const normalizedText = (value, max = 180) =>
          (value || '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

        const closestControl = (target) =>
          target?.closest?.(
            [
              'button',
              'a[href]',
              'input',
              'textarea',
              'select',
              '[contenteditable="true"]',
              '[role="button"]',
              '[role="link"]',
              '[role="menuitem"]',
              '[role="option"]',
              '[role="tab"]',
              '[role="checkbox"]',
              '[role="radio"]',
              '[role="switch"]',
              '[tabindex]:not([tabindex="-1"])',
            ].join(','),
          );

        const inferRole = (element) => {
          const explicit = element.getAttribute('role');
          if (explicit) return explicit;
          const tag = element.tagName.toLowerCase();
          if (tag === 'button') return 'button';
          if (tag === 'a' && element.hasAttribute('href')) return 'link';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'select') return 'combobox';
          if (element.isContentEditable) return 'textbox';
          if (tag !== 'input') return null;
          const type = (element.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset'].includes(type)) return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          return 'textbox';
        };

        const inferName = (element) => {
          const ariaLabel = normalizedText(element.getAttribute('aria-label'));
          if (ariaLabel) return ariaLabel;
          const labelledBy = element.getAttribute('aria-labelledby');
          if (labelledBy) {
            const label = normalizedText(
              labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent)
                .filter(Boolean)
                .join(' '),
            );
            if (label) return label;
          }
          const labels = element.labels
            ? normalizedText(
                [...element.labels].map((label) => label.textContent).join(' '),
              )
            : null;
          return (
            labels ||
            normalizedText(element.getAttribute('title')) ||
            normalizedText(element.innerText || element.textContent) ||
            normalizedText(element.getAttribute('placeholder')) ||
            normalizedText(element.getAttribute('name'))
          );
        };

        const stableSelector = (element) => {
          const escape = (value) => CSS.escape(value);
          if (element.id && !/\d{5,}/.test(element.id)) {
            return `#${escape(element.id)}`;
          }
          for (const attribute of [
            'data-testid',
            'data-test',
            'data-qa',
            'aria-label',
            'name',
          ]) {
            const value = element.getAttribute(attribute);
            if (value) {
              return `${element.tagName.toLowerCase()}[${attribute}="${escape(
                value,
              )}"]`;
            }
          }
          const parts = [];
          let current = element;
          while (
            current &&
            current.nodeType === Node.ELEMENT_NODE &&
            parts.length < 5
          ) {
            const tag = current.tagName.toLowerCase();
            const siblings = current.parentElement
              ? [...current.parentElement.children].filter(
                  (child) => child.tagName === current.tagName,
                )
              : [];
            const suffix =
              siblings.length > 1
                ? `:nth-of-type(${siblings.indexOf(current) + 1})`
                : '';
            parts.unshift(`${tag}${suffix}`);
            current = current.parentElement;
          }
          return parts.join(' > ');
        };

        const desiredStateFor = (element, action) => {
          if (action !== 'click') return null;
          const type = (element.getAttribute('type') || '').toLowerCase();
          if (type === 'radio') return 'checked';
          if (type === 'checkbox') {
            return element.checked ? 'unchecked' : 'checked';
          }
          const selected = element.getAttribute('aria-selected');
          if (selected !== null) return 'selected';
          const pressed = element.getAttribute('aria-pressed');
          if (pressed !== null) {
            return pressed === 'true' ? 'not-pressed' : 'pressed';
          }
          return null;
        };

        const payloadFor = (element, action, value) => {
          const rect = element.getBoundingClientRect();
          const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
          };
          return {
            action,
            value,
            desiredState: desiredStateFor(element, action),
            pageUrl: location.href,
            frameUrl: location.href,
            fingerprint: {
              tag: element.tagName.toLowerCase(),
              role: inferRole(element),
              name: inferName(element),
              text: normalizedText(element.innerText || element.textContent),
              ariaLabel: normalizedText(element.getAttribute('aria-label')),
              title: normalizedText(element.getAttribute('title')),
              placeholder: normalizedText(
                element.getAttribute('placeholder'),
              ),
              testId:
                element.getAttribute('data-testid') ||
                element.getAttribute('data-test') ||
                element.getAttribute('data-qa') ||
                null,
              inputType: element.getAttribute('type'),
              css: stableSelector(element),
            },
            visualAnchor: {
              x: (rect.x + rect.width / 2) / viewport.width,
              y: (rect.y + rect.height / 2) / viewport.height,
              viewport,
            },
          };
        };

        const flash = (element) => {
          const oldOutline = element.style.outline;
          const oldOffset = element.style.outlineOffset;
          const oldShadow = element.style.boxShadow;
          element.style.outline = '2px solid #22c55e';
          element.style.outlineOffset = '3px';
          element.style.boxShadow = '0 0 0 6px rgba(34,197,94,.22)';
          window.setTimeout(() => {
            element.style.outline = oldOutline;
            element.style.outlineOffset = oldOffset;
            element.style.boxShadow = oldShadow;
          }, 450);
        };

        const record = (element, action, value) => {
          if (!element || element.closest('#__flow-recorder-panel')) return;
          flash(element);
          void window[bindingName](payloadFor(element, action, value));
        };

        const inputValue = (element) =>
          element.isContentEditable ? element.innerText : element.value;

        const flushInput = () => {
          window.clearTimeout(state.inputTimer);
          if (!state.pendingInput) return;
          const { element, value } = state.pendingInput;
          state.pendingInput = null;
          record(element, 'fill', value);
        };

        const onInput = (event) => {
          const element = closestControl(event.target);
          if (!element) return;
          const type = (element.getAttribute('type') || '').toLowerCase();
          if (
            type === 'password' ||
            element.getAttribute('autocomplete') === 'current-password'
          ) {
            return;
          }
          state.pendingInput = {
            element,
            value: inputValue(element),
          };
          window.clearTimeout(state.inputTimer);
          state.inputTimer = window.setTimeout(flushInput, 500);
        };

        const onChange = (event) => {
          const element = closestControl(event.target);
          if (!element) return;
          if (element.matches('input[type="file"]')) {
            record(element, 'upload');
          } else if (element.tagName.toLowerCase() === 'select') {
            record(element, 'select', element.value);
          } else {
            flushInput();
          }
        };

        const onClick = (event) => {
          const element = closestControl(event.target);
          if (!element) return;
          flushInput();
          if (!element.matches('input[type="file"]')) {
            record(element, 'click');
          }
        };

        const cleanup = () => {
          flushInput();
          panel.remove();
          document.removeEventListener('click', onClick, true);
          document.removeEventListener('input', onInput, true);
          document.removeEventListener('change', onChange, true);
          delete window.__flowRecorder;
        };

        document.addEventListener('click', onClick, true);
        document.addEventListener('input', onInput, true);
        document.addEventListener('change', onChange, true);
        window.__flowRecorder = { cleanup };
      }, { bindingName: BINDING_NAME, recipeName })
      .catch(() => {});
  };

  for (const frame of page.frames()) await injectFrame(frame);

  const onFrameNavigated = (frame) => {
    setTimeout(() => {
      void injectFrame(frame);
    }, 250);
  };
  page.on('framenavigated', onFrameNavigated);

  return {
    recipePath,
    async stop() {
      page.off('framenavigated', onFrameNavigated);
      for (const frame of page.frames()) {
        await frame
          .evaluate(() => window.__flowRecorder?.cleanup?.())
          .catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      await queue;
      await persist();
      return recipe;
    },
  };
}
