const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

app = app.replace(
  /fetch\('\/api\/status'\, \{ cache: 'no-store' \}\)/g,
  "fetch(`/api/status?workspaceId=${currentWorkspaceId || ''}`, { cache: 'no-store' })"
);
app = app.replace(
  /fetch\('\/api\/flow\/sessions'\, \{/g,
  "fetch(`/api/flow/sessions?workspaceId=${currentWorkspaceId || ''}`, {"
);
app = app.replace(
  /request\('\/api\/chrome\/start'\)/g,
  "request('/api/chrome/start', { workspaceId: currentWorkspaceId })"
);
app = app.replace(
  /request\('\/api\/auth'\)/g,
  "request('/api/auth', { workspaceId: currentWorkspaceId })"
);
app = app.replace(
  /request\('\/api\/record\/start'\, \{/g,
  "request('/api/record/start', { workspaceId: currentWorkspaceId,"
);
app = app.replace(
  /request\('\/api\/record\/stop'\)/g,
  "request('/api/record/stop', { workspaceId: currentWorkspaceId })"
);
app = app.replace(
  /request\('\/api\/replay'\, \{/g,
  "request('/api/replay', { workspaceId: currentWorkspaceId,"
);
app = app.replace(
  /request\('\/api\/registry\/reset'\)/g,
  "request('/api/registry/reset', { workspaceId: currentWorkspaceId })"
);
app = app.replace(
  /request\('\/api\/flow\/session\/new'\)/g,
  "request('/api/flow/session/new', { workspaceId: currentWorkspaceId })"
);
app = app.replace(
  /request\('\/api\/flow\/session\/activate'\, \{/g,
  "request('/api/flow/session/activate', { workspaceId: currentWorkspaceId,"
);
app = app.replace(
  /request\('\/api\/script-studio\/run-flow'\, \{/g,
  "request('/api/script-studio/run-flow', { workspaceId: currentWorkspaceId,"
);

fs.writeFileSync('public/app.js', app);
console.log('App.js endpoints updated.');
