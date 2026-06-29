import crypto from 'node:crypto';
import http from 'node:http';
import { addOrUpdateProvider } from './ai-provider-store.js';

let localListener = null;

function ensureLocalListener(originUri) {
  if (localListener) return;
  localListener = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:1455`);
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (code && state) {
           try {
             await handleOAuthCallback(code, state, 'http://localhost:1455/auth/callback');
             res.writeHead(200, { 'Content-Type': 'text/html' });
             res.end('<h2>OAuth connected successfully</h2><p>You can close this window and return to Flow Batch Studio.</p>');
           } catch(err) {
             res.writeHead(200, { 'Content-Type': 'text/html' });
             res.end('<h2>OAuth connection failed</h2><p>' + err.message + '</p>');
           }
           return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    } catch(e) {
      res.writeHead(500);
      res.end('Error');
    }
  });
  localListener.on('error', (e) => {
    console.error('Local listener 1455 error:', e.message);
  });
  localListener.listen(1455, () => {
    console.log('Local listener for OAuth callback started on port 1455');
  });
}

// Map to store pending OAuth sessions
// Key: state string
// Value: { codeVerifier, catalogId, connectionName, clientId, clientSecret, authorizationUrl, tokenUrl, scopes, baseUrl, createdAt, expiresAt }
const pendingOAuthSessions = new Map();

// Generate a random URL-safe string
function generateRandomString(length = 43) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

// Generate code challenge from verifier using S256
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function getOAuthStatus(state) {
  const session = pendingOAuthSessions.get(state);
  if (!session) return { status: 'expired' };
  return { status: session.status || 'pending', providerId: session.providerId, message: session.message };
}

export async function completeOAuthManual(callbackUrl) {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new Error('Missing code or state in URL');
  
  const session = pendingOAuthSessions.get(state);
  if (!session) throw new Error('Session not found or expired');
  
  let rUri = session.callbackMode === 'local_1455' ? 'http://localhost:1455/auth/callback' : new URL(callbackUrl).origin + '/api/ai/oauth/callback';
  if (session.finalRedirectUri) rUri = session.finalRedirectUri;

  return await handleOAuthCallback(code, state, rUri);
}

export function startOAuthFlow(payload) {
  const state = generateRandomString(32);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = generateCodeChallenge(codeVerifier);

  let finalRedirectUri = payload.redirectUri;
  if (payload.callbackMode === 'local_1455') {
    finalRedirectUri = 'http://localhost:1455/auth/callback';
    const mainOrigin = new URL(payload.redirectUri).origin;
    ensureLocalListener(mainOrigin);
  }

  const session = {
    state,
    codeVerifier,
    status: 'pending',
    finalRedirectUri,
    callbackMode: payload.callbackMode,
    catalogId: payload.catalogId,
    connectionName: payload.connectionName,
    clientId: payload.clientId,
    clientSecret: payload.clientSecret,
    authorizationUrl: payload.authorizationUrl,
    tokenUrl: payload.tokenUrl,
    scopes: payload.scopes || [],
    baseUrl: payload.baseUrl || '',
    adapter: payload.adapter || 'openai-compatible',
    family: payload.family || 'custom',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes TTL
  };

  pendingOAuthSessions.set(state, session);

  // Clean up expired sessions periodically (basic GC)
  for (const [s, data] of pendingOAuthSessions.entries()) {
    if (new Date(data.expiresAt) < new Date()) {
      pendingOAuthSessions.delete(s);
    }
  }

  // Construct authorization URL
  const url = new URL(payload.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', payload.clientId);
  url.searchParams.set('redirect_uri', finalRedirectUri);
  url.searchParams.set('state', state);
  
  if (payload.extraAuthorizeParams) {
    for (const [k, v] of Object.entries(payload.extraAuthorizeParams)) {
      url.searchParams.set(k, v);
    }
  }

  if (payload.scopes && payload.scopes.length > 0) {
    let scopeStr = payload.scopes;
    if (Array.isArray(scopeStr)) scopeStr = scopeStr.join(' ');
    url.searchParams.set('scope', scopeStr);
  }
  
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

export async function handleOAuthCallback(code, state, redirectUri) {
  const session = pendingOAuthSessions.get(state);
  
  if (!session) {
    throw new Error('OAuth session not found or state mismatched');
  }
  if (new Date(session.expiresAt) < new Date()) {
    pendingOAuthSessions.delete(state);
    throw new Error('OAuth session expired');
  }

  // Exchange code for token
  const bodyParams = new URLSearchParams();
  bodyParams.append('grant_type', 'authorization_code');
  bodyParams.append('client_id', session.clientId);
  if (session.clientSecret) {
    bodyParams.append('client_secret', session.clientSecret);
  }
  bodyParams.append('code', code);
  bodyParams.append('redirect_uri', redirectUri);
  bodyParams.append('code_verifier', session.codeVerifier);

  const response = await fetch(session.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: bodyParams.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || response.statusText}`);
  }

  if (!data.access_token) {
    throw new Error('Token endpoint did not return an access_token');
  }

  const expiresIn = data.expires_in ? parseInt(data.expires_in, 10) : 3600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Save the provider
  const providerData = {
    catalogId: session.catalogId,
    category: 'oauth',
    family: session.family,
    adapter: session.adapter,
    name: session.connectionName,
    baseUrl: session.baseUrl,
    authMode: 'oauth',
    authHeaderStyle: 'bearer',
    clientId: session.clientId,
    clientSecret: session.clientSecret,
    oauthToken: data.access_token, // This gets mapped to oauthToken in store and masked in getMaskedProviders
    refreshToken: data.refresh_token || null,
    idToken: data.id_token || null,
    expiresAt: tokenExpiresAt,
    lastTestStatus: 'connected',
    lastTestedAt: new Date().toISOString()
  };

  const saved = await addOrUpdateProvider(providerData);
  session.status = 'connected';
  session.providerId = saved.id;
  setTimeout(() => pendingOAuthSessions.delete(state), 30000);
  return saved;
}
