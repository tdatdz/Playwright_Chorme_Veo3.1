const fs = require('fs');
let code = fs.readFileSync('src/flow-batch-executor.js', 'utf8');

const startIdx = code.indexOf('function normalizePromptText');
const endIdx = code.indexOf('function contentExtension(contentType, mediaType) {');

const newSubmitJob = `async function submitJob(
  page,
  settings,
  job,
  knownTileIds,
  emit,
  onJobUpdate,
  workspaceId
) {
  const { textbox, composer } = await composerFor(page);

  await onJobUpdate(job, { progress: 0, status: 'running' });

  if (Array.isArray(job.references) && job.references.some(Boolean)) {
    await emit('GUARD', 'Reference input đang tạm tắt; chạy prompt-only để ổn định runner.');
  }

  await observedFill(page, textbox, job.prompt, \`prompt \${job.code}\`, emit);

  const currentPrompt = (await textbox.innerText()).replace(/\\s+/g, ' ').trim();
  const expectedPrompt = String(job.prompt || '').replace(/\\s+/g, ' ').trim();

  if (!currentPrompt.includes(expectedPrompt.slice(0, 80))) {
    throw new Error('Prompt verification failed after fill.');
  }

  const generateButton = await visibleUnique(
    composer.locator('button:not([aria-haspopup]):has-text("arrow_forward")'),
    'Generate',
  );

  if (!(await generateButton.isEnabled())) {
    throw new Error('Generate button is disabled after prompt fill.');
  }

  await observedClick(page, generateButton, 'Generate', emit);
  await emit('SUCCESS', \`\${job.code} đã gửi lệnh tạo sang Flow.\`);

  const tiles = await waitForNewTiles(
    page,
    knownTileIds,
    expectedOutputCount(settings.count),
    emit,
  );

  return { tileIds: tiles.map((tile) => tile.id) };
}`;

const newCode = code.slice(0, startIdx) + newSubmitJob + '\n\n' + code.slice(endIdx);
fs.writeFileSync('src/flow-batch-executor.js', newCode);
console.log('Successfully rolled back flow-batch-executor.js');
