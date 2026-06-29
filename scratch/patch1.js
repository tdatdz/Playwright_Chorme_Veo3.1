const fs = require('fs');

let code = fs.readFileSync('src/flow-batch-executor.js', 'utf8');

// Replace submitJob signature
code = code.replace(
  /async function submitJob\\(\\s*page,\\s*settings,\\s*job,\\s*knownTileIds,\\s*emit,\\s*\\)/,
  'async function submitJob(page, settings, job, knownTileIds, emit, onJobUpdate, workspaceId)'
);
// wait, the signature didn't have trailing comma maybe? Let's do string replacement
const oldSubmitJobDecl = `async function submitJob(
  page,
  settings,
  job,
  knownTileIds,
  emit,
) {`;
const newSubmitJobDecl = `async function getComposerAttachmentCount(composer) {
  return await composer.locator('img,video,[data-slate-void="true"], [aria-label*="attachment"], [data-testid*="attachment"]').count();
}

async function clearComposer(page, composer, emit, workspaceId, jobId) {
  let count = await getComposerAttachmentCount(composer);
  const { textbox } = await composerFor(page);
  let text = (await textbox.innerText()).trim();
  if (count === 0 && text.length === 0) return;
  
  await emit('INFO', \`[\${workspaceId}/\${jobId}] Composer is not empty (attachments: \${count}, text length: \${text.length}). Attempting to clear...\`);
  
  // click X buttons
  const removeBtns = composer.locator('button[aria-label*="remove"], button[aria-label*="Delete"], button[aria-label*="Xóa"], button[title*="Xóa"]');
  for (let i = 0; i < 5; i++) {
    if (await removeBtns.count() > 0) {
      await removeBtns.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // select all and delete text
  await textbox.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);

  count = await getComposerAttachmentCount(composer);
  text = (await textbox.innerText()).trim();
  if (count > 0 || text.length > 0) {
    throw new Error('Không thể clear composer cũ. Chặn để không nhầm ảnh hoặc text.');
  }
}

async function uploadReferenceToMediaLibrary(page, filePath, emit, workspaceId, jobId, slotIndex) {
  await emit('INFO', \`[\${workspaceId}/\${jobId}] uploading reference slot=\${slotIndex} file=\${filePath}\`);
  const { composer } = await composerFor(page);
  
  // Click '+' button if available, or just the image add button
  const addButton = await visibleUnique(
    composer.locator('button[aria-haspopup="dialog"], button[aria-label="Thêm nội dung nghe nhìn"]'),
    'Add reference',
  );
  await observedClick(page, addButton, 'mở Reference picker', emit);
  const uploadButton = await visibleUnique(
    page
      .getByRole('button')
      .filter({ hasText: /Tải (?:nội dung nghe nhìn)? lên|Upload/i }),
    'Upload reference',
  );
  const observation = await observeBeforeAction(uploadButton);
  await assertNoUnexpectedUi(page, uploadButton);
  await showActionIndicator(page, uploadButton, { action: 'upload', control: 'Upload', previewMs: 450 });

  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 });
    await uploadButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  } finally {
    await clearActionIndicator(page);
  }
  
  // Wait for upload to complete by observing the first item in the media panel
  const mediaLibrary = page.locator('div[role="dialog"]');
  // Just wait for UI to stabilize and file to appear
  await page.waitForTimeout(1500);
  await emit('INFO', \`[\${workspaceId}/\${jobId}] uploaded reference slot=\${slotIndex}\`);
}

async function attachReferenceToPromptComposer(page, composer, expectedCount, emit, workspaceId, jobId, slotIndex) {
  await emit('INFO', \`[\${workspaceId}/\${jobId}] attaching reference slot=\${slotIndex} method=plus-picker\`);
  
  const mediaLibrary = page.locator('div[role="dialog"]');
  const firstThumbnail = mediaLibrary.locator('img, video').first();
  await firstThumbnail.waitFor({ state: 'visible', timeout: 15_000 });
  
  // Method 1: click thumbnail, click add
  await firstThumbnail.click();
  const submitButton = page.locator('button:has-text("Thêm vào câu lệnh")');
  if (await submitButton.isVisible().catch(() => false)) {
    await submitButton.click();
  } else {
    // Method 2/3 Fallback: drag and drop
    await emit('INFO', \`[\${workspaceId}/\${jobId}] attaching reference slot=\${slotIndex} method=drag-drop\`);
    const composerBox = await composer.boundingBox();
    const thumbBox = await firstThumbnail.boundingBox();
    if (composerBox && thumbBox) {
      await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(composerBox.x + composerBox.width / 2, composerBox.y + composerBox.height / 2, { steps: 5 });
      await page.mouse.up();
    }
  }

  await page.waitForTimeout(1000);
  const afterCount = await getComposerAttachmentCount(composer);
  if (afterCount < expectedCount) {
    throw new Error('Reference was uploaded but Flow did not confirm attachment in the prompt.');
  }
  
  // Press Escape to close media library if it is still open
  await page.keyboard.press('Escape').catch(() => {});
  await emit('INFO', \`[\${workspaceId}/\${jobId}] reference attached slot=\${slotIndex} count=\${afterCount}\`);
}

async function submitJob(
  page,
  settings,
  job,
  knownTileIds,
  emit,
  onJobUpdate,
  workspaceId
) {`;

code = code.replace(oldSubmitJobDecl, newSubmitJobDecl);

fs.writeFileSync('src/flow-batch-executor.js', code);
console.log('Done replacement');
