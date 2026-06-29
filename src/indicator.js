const INDICATOR_ID = '__flow-bot-action-indicator';
const STYLE_ID = '__flow-bot-action-indicator-style';

function indicatorDelay(step) {
  const configured = Number(
    step.previewMs ?? process.env.FLOW_ACTION_DELAY_MS ?? 900,
  );
  return Number.isFinite(configured) ? Math.max(0, configured) : 900;
}

export async function showActionIndicator(page, locator, step) {
  if (process.env.FLOW_SHOW_ACTIONS === '0') return;

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return;

  const duration = indicatorDelay(step);
  const label = `${String(step.action || 'ACTION').toUpperCase()} · ${
    step.control || 'control'
  }`;

  await page.evaluate(
    ({ box, duration, label, indicatorId, styleId }) => {
      document.getElementById(indicatorId)?.remove();

      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          @keyframes flowBotActionPulse {
            0% {
              box-shadow:
                0 0 0 0 rgba(34, 197, 94, .90),
                0 0 18px 2px rgba(34, 197, 94, .55);
            }
            70% {
              box-shadow:
                0 0 0 9px rgba(34, 197, 94, 0),
                0 0 22px 3px rgba(34, 197, 94, .35);
            }
            100% {
              box-shadow:
                0 0 0 0 rgba(34, 197, 94, 0),
                0 0 14px 1px rgba(34, 197, 94, .45);
            }
          }
          @keyframes flowBotActionBadge {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `;
        document.documentElement.appendChild(style);
      }

      const indicator = document.createElement('div');
      indicator.id = indicatorId;
      indicator.setAttribute('aria-hidden', 'true');
      Object.assign(indicator.style, {
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        left: `${Math.max(2, box.x - 4)}px`,
        top: `${Math.max(2, box.y - 4)}px`,
        width: `${Math.max(4, box.width + 8)}px`,
        height: `${Math.max(4, box.height + 8)}px`,
        boxSizing: 'border-box',
        border: '2px solid #22c55e',
        borderRadius: `${Math.min(16, Math.max(8, box.height / 2))}px`,
        background: 'rgba(34, 197, 94, .06)',
        animation: `flowBotActionPulse 700ms ease-out infinite`,
      });

      const badge = document.createElement('div');
      badge.textContent = label;
      Object.assign(badge.style, {
        position: 'absolute',
        left: '0',
        bottom: 'calc(100% + 7px)',
        maxWidth: '320px',
        padding: '5px 8px',
        overflow: 'hidden',
        border: '1px solid rgba(74, 222, 128, .8)',
        borderRadius: '7px',
        background: 'rgba(5, 46, 22, .96)',
        color: '#dcfce7',
        font: '600 11px/1.2 system-ui, sans-serif',
        letterSpacing: '.02em',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        animation: 'flowBotActionBadge 160ms ease-out both',
      });
      indicator.appendChild(badge);
      document.documentElement.appendChild(indicator);

      window.clearTimeout(window.__flowBotIndicatorTimer);
      window.__flowBotIndicatorTimer = window.setTimeout(
        () => indicator.remove(),
        Math.max(duration + 1_500, 2_000),
      );
    },
    { box, duration, label, indicatorId: INDICATOR_ID, styleId: STYLE_ID },
  );

  if (duration > 0) await page.waitForTimeout(duration);
}

export async function clearActionIndicator(page) {
  await page
    .evaluate((indicatorId) => {
      document.getElementById(indicatorId)?.remove();
    }, INDICATOR_ID)
    .catch(() => {});
}

