import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'ai-providers.json');

let cache = null;

async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (err) {
    // ignore
  }
}

export async function loadProviders() {
  if (cache) return cache;
  try {
    const data = await fs.readFile(PROVIDERS_FILE, 'utf8');
    cache = JSON.parse(data);
  } catch (err) {
    cache = { providers: [], defaultProviderId: null };
  }
  return cache;
}

export async function saveProviders(data) {
  cache = data;
  await ensureConfigDir();
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function maskApiKey(key) {
  if (!key) return null;
  if (key.length <= 4) return '****';
  const prefix = key.startsWith('sk-') ? 'sk-' : '';
  const actualKey = key.startsWith('sk-') ? key.slice(3) : key;
  if (actualKey.length <= 4) return `${prefix}****`;
  return `${prefix}****${actualKey.slice(-4)}`;
}

export async function getMaskedProviders() {
  const data = await loadProviders();
  return {
    providers: data.providers.map(p => ({
      id: p.id,
      category: p.category || 'api',
      name: p.name,
      type: p.type || 'openai-compatible',
      baseUrl: p.baseUrl,
      authMode: p.authMode || 'api_key',
      apiKeyMasked: maskApiKey(p.apiKey),
      oauthMasked: maskApiKey(p.oauthToken),
      defaultModel: p.defaultModel,
      lastTestStatus: p.lastTestStatus || 'untested',
      lastTestedAt: p.lastTestedAt || null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    })),
    defaultProviderId: data.defaultProviderId
  };
}

export async function addOrUpdateProvider(provider) {
  const data = await loadProviders();
  const existingIndex = data.providers.findIndex(p => p.id === provider.id);
  
  if (existingIndex >= 0) {
    const old = data.providers[existingIndex];
    let newApiKey = provider.apiKey;
    if (!newApiKey || newApiKey === maskApiKey(old.apiKey)) {
      newApiKey = old.apiKey;
    }
    let newOauth = provider.oauthToken;
    if (!newOauth || newOauth === maskApiKey(old.oauthToken)) {
      newOauth = old.oauthToken;
    }

    data.providers[existingIndex] = {
      ...old,
      category: provider.category || old.category || 'api',
      name: provider.name || old.name,
      baseUrl: provider.baseUrl || old.baseUrl,
      authMode: provider.authMode || old.authMode,
      apiKey: newApiKey,
      oauthToken: newOauth,
      defaultModel: provider.defaultModel || old.defaultModel,
      lastTestStatus: provider.lastTestStatus || old.lastTestStatus,
      lastTestedAt: provider.lastTestedAt || old.lastTestedAt,
      updatedAt: new Date().toISOString()
    };
  } else {
    data.providers.push({
      ...provider,
      id: provider.id || `provider_${Date.now()}`,
      category: provider.category || 'api',
      authMode: provider.authMode || 'api_key',
      lastTestStatus: provider.lastTestStatus || 'untested',
      lastTestedAt: provider.lastTestedAt || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  if (data.providers.length === 1 && !data.defaultProviderId) {
    data.defaultProviderId = data.providers[0].id;
  }
  
  await saveProviders(data);
  return data.providers.find(p => p.id === provider.id || p.id === data.providers[data.providers.length - 1].id);
}

export async function deleteProvider(id) {
  const data = await loadProviders();
  data.providers = data.providers.filter(p => p.id !== id);
  if (data.defaultProviderId === id) {
    data.defaultProviderId = data.providers.length > 0 ? data.providers[0].id : null;
  }
  await saveProviders(data);
}

export async function setDefaultProvider(id) {
  const data = await loadProviders();
  if (data.providers.find(p => p.id === id)) {
    data.defaultProviderId = id;
    await saveProviders(data);
  }
}

export async function getProviderById(id) {
  const data = await loadProviders();
  return data.providers.find(p => p.id === id);
}
