const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

app = app.replace(
  /fetch\(`\/api\/status\?workspaceId=\$\{currentWorkspaceId \|\| ''\}`\, \{ cache: 'no-store' \}\)/g,
  "fetch('/api/status', { cache: 'no-store' })"
);
app = app.replace(
  /fetch\(`\/api\/flow\/sessions\?workspaceId=\$\{currentWorkspaceId \|\| ''\}`\, \{/g,
  "fetch('/api/flow/sessions', {"
);
app = app.replace(
  /request\('\/api\/chrome\/start', \{ workspaceId: currentWorkspaceId \}\)/g,
  "request('/api/chrome/start')"
);
app = app.replace(
  /request\('\/api\/auth', \{ workspaceId: currentWorkspaceId \}\)/g,
  "request('/api/auth')"
);
app = app.replace(
  /request\('\/api\/record\/start', \{ workspaceId: currentWorkspaceId,/g,
  "request('/api/record/start', {"
);
app = app.replace(
  /request\('\/api\/record\/stop', \{ workspaceId: currentWorkspaceId \}\)/g,
  "request('/api/record/stop')"
);
app = app.replace(
  /request\('\/api\/replay', \{ workspaceId: currentWorkspaceId,/g,
  "request('/api/replay', {"
);
app = app.replace(
  /request\('\/api\/registry\/reset', \{ workspaceId: currentWorkspaceId \}\)/g,
  "request('/api/registry/reset')"
);
app = app.replace(
  /request\('\/api\/flow\/session\/new', \{ workspaceId: currentWorkspaceId \}\)/g,
  "request('/api/flow/session/new')"
);
app = app.replace(
  /request\('\/api\/flow\/session\/activate', \{ workspaceId: currentWorkspaceId,/g,
  "request('/api/flow/session/activate', {"
);
app = app.replace(
  /request\('\/api\/script-studio\/run-flow', \{ workspaceId: currentWorkspaceId,/g,
  "request('/api/script-studio/run-flow', {"
);

fs.writeFileSync('public/app.js.reverted', app);
console.log('Reverted endpoints written to public/app.js.reverted');
