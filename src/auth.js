import fs from 'node:fs/promises';
import path from 'node:path';

export const COOKIE_PATH = path.resolve('config', 'cookies.json');

const ALLOWED_SAME_SITE = new Set(['Strict', 'Lax', 'None']);

function normalizeSameSite(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase().replace(/[_-]/g, '');
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'lax') return 'Lax';
  if (['none', 'norestriction'].includes(normalized)) return 'None';
  return undefined;
}

function isGoogleHost(hostname) {
  const host = hostname.replace(/^\./, '').toLowerCase();
  return (
    host === 'labs.google' ||
    host.endsWith('.labs.google') ||
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    host === 'googleusercontent.com' ||
    host.endsWith('.googleusercontent.com')
  );
}

function normalizeCookie(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Cookie #${index + 1} must be an object.`);
  }
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error(`Cookie #${index + 1} is missing a string "name".`);
  }
  if (typeof raw.value !== 'string') {
    throw new Error(`Cookie "${raw.name}" is missing a string "value".`);
  }

  const cookie = {
    name: raw.name,
    value: raw.value,
  };

  if (raw.url) {
    const url = new URL(raw.url);
    if (url.protocol !== 'https:' || !isGoogleHost(url.hostname)) {
      throw new Error(
        `Cookie "${raw.name}" URL must be an HTTPS Google domain.`,
      );
    }
    cookie.url = url.toString();
  } else {
    if (!raw.domain || !isGoogleHost(raw.domain)) {
      throw new Error(
        `Cookie "${raw.name}" domain must be labs.google, google.com, or googleusercontent.com.`,
      );
    }
    cookie.domain = raw.domain;
    cookie.path = raw.path || '/';
  }

  const rawExpiry = raw.expires ?? raw.expirationDate;
  if (Number.isFinite(Number(rawExpiry)) && Number(rawExpiry) > 0) {
    const numericExpiry = Number(rawExpiry);
    cookie.expires =
      numericExpiry > 10_000_000_000
        ? Math.floor(numericExpiry / 1_000)
        : numericExpiry;
  }
  if (typeof raw.httpOnly === 'boolean') cookie.httpOnly = raw.httpOnly;
  if (typeof raw.secure === 'boolean') cookie.secure = raw.secure;

  const sameSite = normalizeSameSite(raw.sameSite);
  if (sameSite && ALLOWED_SAME_SITE.has(sameSite)) {
    cookie.sameSite = sameSite;
  }

  return cookie;
}

export async function readCookieFile(cookiePath = COOKIE_PATH) {
  let raw;
  try {
    raw = await fs.readFile(cookiePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { mode: 'manual', reason: 'missing', cookies: [] };
    }
    throw error;
  }

  if (!raw.trim()) {
    return { mode: 'manual', reason: 'empty', cookies: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Cookie file is not valid JSON: ${cookiePath}`);
  }

  const source = Array.isArray(parsed) ? parsed : parsed.cookies;
  if (!Array.isArray(source) || source.length === 0) {
    return { mode: 'manual', reason: 'no-cookies', cookies: [] };
  }

  const cookies = source
    .filter(
      (cookie) =>
        cookie?.value &&
        cookie.value !== 'PASTE_COOKIE_VALUE_HERE',
    )
    .map(normalizeCookie);

  if (cookies.length === 0) {
    return { mode: 'manual', reason: 'placeholders-only', cookies: [] };
  }
  return { mode: 'cookie', cookies };
}

export async function authenticate(page, cookiePath = COOKIE_PATH) {
  const result = await readCookieFile(cookiePath);
  if (result.mode === 'manual') return result;

  await page.context().addCookies(result.cookies);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return {
    mode: 'cookie',
    imported: result.cookies.length,
    url: page.url(),
  };
}
