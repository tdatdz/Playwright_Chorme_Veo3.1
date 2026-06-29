import { saveControl } from './registry.js';

const BINDING_NAME = '__flowTrainerSave';

export async function installTrainer(
  page,
  onSaved = () => {},
  { guidedControls = [] } = {},
) {
  try {
    await page.exposeBinding(BINDING_NAME, async (_source, payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(payload.key || '')) {
        throw new Error(
          'Control key may only contain letters, numbers, dot, underscore, and dash.',
        );
      }
      const saved = await saveControl({
        ...payload,
        capturedAt: new Date().toISOString(),
      });
      onSaved(saved);
    });
  } catch (error) {
    if (!String(error.message).includes('has been already registered')) {
      throw error;
    }
  }

  for (const frame of page.frames()) {
    await frame
      .evaluate(({ bindingName, guidedControls }) => {
        const previous = window.__flowTrainer;
        if (previous?.cleanup) previous.cleanup();

        const state = {
          highlighted: null,
          previousOutline: '',
          previousOutlineOffset: '',
          guidedIndex: 0,
          pending: null,
          saving: false,
        };

        const panel = document.createElement('div');
        panel.id = '__flow-trainer-panel';
        const updatePanel = (message) => {
          if (message) {
            panel.textContent = message;
            return;
          }
          const guide = guidedControls[state.guidedIndex];
          panel.textContent = guide
            ? `FLOW TRAINER ${state.guidedIndex + 1}/${
                guidedControls.length
              } · Cần chọn: ${guide.label} [${guide.key}]`
            : 'FLOW TRAINER · Giữ Alt rồi click nút để đặt tên · Esc để thoát';
        };
        updatePanel();
        Object.assign(panel.style, {
          position: 'fixed',
          zIndex: '2147483647',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 14px',
          borderRadius: '8px',
          background: '#172554',
          color: '#fff',
          font: '600 13px/1.3 system-ui, sans-serif',
          boxShadow: '0 8px 28px rgba(0,0,0,.35)',
          pointerEvents: 'none',
        });
        document.documentElement.appendChild(panel);

        const clearHighlight = () => {
          if (!state.highlighted) return;
          state.highlighted.style.outline = state.previousOutline;
          state.highlighted.style.outlineOffset = state.previousOutlineOffset;
          state.highlighted = null;
        };

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
          if (tag !== 'input') return null;
          const type = (element.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset'].includes(type)) return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          return 'textbox';
        };

        const normalizedText = (value, max = 180) =>
          (value || '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

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

        const makePayload = (element, key) => {
          const rect = element.getBoundingClientRect();
          const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
          };
          return {
            key,
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

        const onMouseMove = (event) => {
          if (!event.altKey) {
            clearHighlight();
            return;
          }
          const control = closestControl(event.target);
          if (!control || control === state.highlighted) return;
          clearHighlight();
          state.highlighted = control;
          state.previousOutline = control.style.outline;
          state.previousOutlineOffset = control.style.outlineOffset;
          control.style.outline = '3px solid #22d3ee';
          control.style.outlineOffset = '3px';
        };

        const onClick = (event) => {
          if (!event.altKey) return;
          const control = closestControl(event.target);
          if (!control) return;
          event.preventDefault();
          event.stopImmediatePropagation();

          const suggested = [
            'flow',
            inferRole(control) || control.tagName.toLowerCase(),
            inferName(control)
              ?.toLowerCase()
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '')
              .replace(/đ/g, 'd')
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 50) || 'control',
          ].join('.');

          const guide = guidedControls[state.guidedIndex];
          const guidedKey = guide?.key;
          const key =
            guidedKey ||
            window.prompt(
              'Tên nghiệp vụ duy nhất cho control này:',
              suggested,
            );
          if (!key) return;

          const candidateName =
            inferName(control) ||
            `${inferRole(control) || control.tagName.toLowerCase()} không có tên`;
          state.pending = {
            control,
            key: key.trim(),
            guided: Boolean(guidedKey),
          };
          updatePanel(
            `XÁC NHẬN: ${key} ← "${candidateName}" · Enter=Lưu · Esc=Chọn lại`,
          );
        };

        const savePending = async () => {
          if (!state.pending || state.saving) return;
          state.saving = true;
          const pending = state.pending;
          updatePanel(`Đang lưu: ${pending.key}`);
          try {
            await window[bindingName](
              makePayload(pending.control, pending.key),
            );
            state.pending = null;
            if (pending.guided) {
              state.guidedIndex += 1;
              if (state.guidedIndex >= guidedControls.length) {
                updatePanel('Đã dạy đủ control cho keyframe ✓');
                window.setTimeout(cleanup, 700);
              } else {
                updatePanel();
              }
            } else {
              updatePanel(`Đã lưu: ${pending.key} · Alt+click để tiếp tục`);
            }
          } catch (error) {
            updatePanel(`Không lưu được: ${error.message}`);
          } finally {
            state.saving = false;
          }
        };

        const cleanup = () => {
          clearHighlight();
          panel.remove();
          document.removeEventListener('mousemove', onMouseMove, true);
          document.removeEventListener('click', onClick, true);
          document.removeEventListener('keydown', onKeyDown, true);
          delete window.__flowTrainer;
        };

        const onKeyDown = (event) => {
          if (event.key === 'Enter' && state.pending) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void savePending();
            return;
          }
          if (event.key === 'Escape' && state.pending) {
            event.preventDefault();
            event.stopImmediatePropagation();
            state.pending = null;
            updatePanel();
            return;
          }
          if (event.key === 'Escape') cleanup();
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.__flowTrainer = { cleanup };
      }, { bindingName: BINDING_NAME, guidedControls })
      .catch(() => {
        // Cross-origin or transient frames may not be scriptable; skip them.
      });
  }
}
