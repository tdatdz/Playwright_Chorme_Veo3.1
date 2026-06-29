import { chromium } from 'playwright-core';

const DEFAULT_PORTS = [9222, 9223, 9224, 9225];
const FLOW_URL_FRAGMENT = 'labs.google/fx/vi/tools/flow';

async function endpointIsAlive(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body.webSocketDebuggerUrl);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverCdpEndpoint(configuredPort) {
  const configured = process.env.FLOW_CDP_URL;
  if (configured) {
    const endpoint = configured.replace(/\/$/, '');
    if (await endpointIsAlive(endpoint)) return endpoint;
    throw new Error(`FLOW_CDP_URL is not reachable: ${endpoint}`);
  }

  if (configuredPort) {
    const endpoint = `http://127.0.0.1:${configuredPort}`;
    if (await endpointIsAlive(endpoint)) return endpoint;
    throw new Error(`Chrome workspace port ${configuredPort} is not reachable. Có thể Chrome chưa được bật cho workspace này.`);
  }

  const legacyPort = Number(process.env.FLOW_CDP_PORT);
  const ports = Number.isInteger(legacyPort)
    ? [legacyPort]
    : DEFAULT_PORTS;

  for (const port of ports) {
    const endpoint = `http://127.0.0.1:${port}`;
    if (await endpointIsAlive(endpoint)) return endpoint;
  }

  throw new Error(
    'No debuggable Chrome was found. Run "npm run chrome:start" first.',
  );
}

export async function connectToFlow({ requireFlowPage = true, port = null } = {}) {
  const endpoint = await discoverCdpEndpoint(port);
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const page = pages.find((candidate) =>
    candidate.url().includes(FLOW_URL_FRAGMENT),
  );

  if (!page && requireFlowPage) {
    throw new Error(
      `Chrome is connected, but no Google Flow tab is open (${FLOW_URL_FRAGMENT}).`,
    );
  }

  return { browser, endpoint, page, pages };
}

export function describePages(pages) {
  return pages.map((page, index) => ({
    index,
    title: page.url() === 'about:blank' ? '' : undefined,
    url: page.url(),
  }));
}
