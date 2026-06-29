import fs from 'node:fs/promises';
import path from 'node:path';

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
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
].join(',');

export async function scanVisibleControls(page) {
  const frames = page.frames();
  const frameResults = [];

  for (const frame of frames) {
    const controls = await frame.locator(INTERACTIVE_SELECTOR).evaluateAll(
      (elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              rect.width > 0 &&
              rect.height > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const text = (element.innerText || element.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160);
            return {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute('role'),
              name:
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                text ||
                element.getAttribute('placeholder') ||
                element.getAttribute('name'),
              text,
              ariaLabel: element.getAttribute('aria-label'),
              title: element.getAttribute('title'),
              placeholder: element.getAttribute('placeholder'),
              testId:
                element.getAttribute('data-testid') ||
                element.getAttribute('data-test') ||
                element.getAttribute('data-qa'),
              disabled:
                element.matches(':disabled') ||
                element.getAttribute('aria-disabled') === 'true',
              box: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
          }),
    );
    frameResults.push({ frameUrl: frame.url(), controls });
  }

  return {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    frames: frameResults,
  };
}

export async function saveScan(page, outputDir = path.resolve('artifacts')) {
  await fs.mkdir(outputDir, { recursive: true });
  const scan = await scanVisibleControls(page);
  const jsonPath = path.join(outputDir, 'flow-controls-scan.json');
  const screenshotPath = path.join(outputDir, 'flow-controls-scan.png');

  await fs.writeFile(jsonPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return { scan, jsonPath, screenshotPath };
}

