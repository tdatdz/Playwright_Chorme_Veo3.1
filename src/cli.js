import path from 'node:path';
import fs from 'node:fs/promises';
import { authenticate, COOKIE_PATH } from './auth.js';
import { connectToFlow, discoverCdpEndpoint } from './chrome.js';
import { runKeyframe } from './executor.js';
import { loadRegistry, resetRegistry } from './registry.js';
import { installRecorder } from './recorder.js';
import { saveScan } from './scanner.js';
import { installTrainer } from './trainer.js';

function usage() {
  console.log(`
Usage:
  node src/cli.js auth
  node src/cli.js doctor
  node src/cli.js scan
  node src/cli.js record <recipe-name>
  node src/cli.js replay <recipe-name>
  node src/cli.js train [keyframe.json]
  node src/cli.js reset-registry
  node src/cli.js run <keyframe.json>
`);
}

async function auth() {
  const { page } = await connectToFlow();
  const result = await authenticate(page);
  if (result.mode === 'manual') {
    console.log(`No usable cookies found at: ${COOKIE_PATH}`);
    console.log('Please sign in manually in the dedicated Chrome window.');
    console.log('The login session will persist in .chrome-profile.');
    return;
  }
  console.log(`Imported ${result.imported} cookies without printing secrets.`);
  console.log('Flow was reloaded. Confirm the account avatar is visible.');
}

async function doctor() {
  const endpoint = await discoverCdpEndpoint();
  const { page, pages } = await connectToFlow({ requireFlowPage: false });
  console.log(`Chrome CDP: ${endpoint}`);
  console.log(`Open tabs: ${pages.length}`);
  console.log(
    page
      ? `Google Flow: ${page.url()}`
      : 'Google Flow: not found; open https://labs.google/fx/vi/tools/flow',
  );
}

async function scan() {
  const { page } = await connectToFlow();
  const result = await saveScan(page);
  const count = result.scan.frames.reduce(
    (total, frame) => total + frame.controls.length,
    0,
  );
  console.log(`Found ${count} visible controls.`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Screenshot: ${result.screenshotPath}`);
}

async function train(keyframeFile) {
  const { page } = await connectToFlow();
  let guidedControls = [];
  if (keyframeFile) {
    const keyframe = JSON.parse(
      await fs.readFile(path.resolve(keyframeFile), 'utf8'),
    );
    const registry = await loadRegistry();
    const seen = new Set();
    guidedControls = keyframe.steps
      .filter(
        (step) =>
          step.control &&
          !registry.controls[step.control] &&
          !seen.has(step.control),
      )
      .map((step) => {
        seen.add(step.control);
        return {
          key: step.control,
          label: step.trainingLabel || step.control,
        };
      });
    if (guidedControls.length === 0) {
      console.log('All controls required by this keyframe are already trained.');
      return;
    }
  }

  let savedCount = 0;
  let finishGuidedTraining;
  const guidedComplete = new Promise((resolve) => {
    finishGuidedTraining = resolve;
  });

  await installTrainer(page, (entry) => {
    console.log(`Saved: ${entry.key} -> ${entry.fingerprint.name || '?'}`);
    if (guidedControls.length > 0) {
      savedCount += 1;
      if (savedCount >= guidedControls.length) finishGuidedTraining();
    }
  }, { guidedControls });
  console.log('Trainer is active in the Google Flow project tab.');
  if (guidedControls.length > 0) {
    console.log(`Guided controls remaining: ${guidedControls.length}`);
    console.log(
      'Alt+click selects a candidate; press Enter to save or Escape to retry.',
    );
  } else {
    console.log('Hold Alt and click a control to name it without activating it.');
  }
  console.log('Press Ctrl+C in this terminal to stop.');

  const interrupted = new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await Promise.race([
    interrupted,
    guidedControls.length > 0 ? guidedComplete : new Promise(() => {}),
  ]);
  if (
    guidedControls.length > 0 &&
    savedCount >= guidedControls.length
  ) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    console.log('Guided training complete.');
  }
}

async function resetTrainedRegistry() {
  const result = await resetRegistry();
  if (result.backupPath) {
    console.log(`Backed up the previous registry: ${result.backupPath}`);
  }
  console.log(`Reset trained controls: ${result.registryPath}`);
}

async function recordRecipe(name) {
  if (!name) throw new Error('A recipe name is required.');
  const { page } = await connectToFlow();
  const recorder = await installRecorder(page, name, (event) => {
    console.log(
      `#${event.number} ${event.action} -> ${event.name || event.control}`,
    );
  });
  console.log(`Recording recipe: ${name}`);
  console.log('Use Google Flow normally. Clicks and text fields are saved.');
  console.log('Return to this terminal and press Enter to finish recording.');
  process.stdin.resume();
  const pressEnter = new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });
  const interrupted = new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await Promise.race([pressEnter, interrupted]);
  process.stdin.pause();
  const recipe = await recorder.stop();
  console.log(`Saved ${recipe.steps.length} steps: ${recorder.recipePath}`);
}

async function replayRecipe(
  name,
  {
    allowSideEffects = false,
    allowRepeatSideEffects = false,
  } = {},
) {
  if (!name) throw new Error('A recipe name is required.');
  const recipePath = path.resolve(
    'artifacts',
    'recipes',
    `${name}.json`,
  );
  const { page } = await connectToFlow();
  const results = await runKeyframe(page, recipePath, {
    allowSideEffects,
    allowRepeatSideEffects,
  });
  console.table(results);
}

async function run(
  file,
  {
    allowSideEffects = false,
    allowRepeatSideEffects = false,
  } = {},
) {
  if (!file) throw new Error('A keyframe JSON path is required.');
  const { page } = await connectToFlow();
  const results = await runKeyframe(page, path.resolve(file), {
    allowSideEffects,
    allowRepeatSideEffects,
  });
  console.table(results);
}

const [command, argument, ...flags] = process.argv.slice(2);
const allowSideEffects = flags.includes('--commit');
const allowRepeatSideEffects = flags.includes('--force-repeat');
try {
  if (command === 'auth') await auth();
  else if (command === 'doctor') await doctor();
  else if (command === 'scan') await scan();
  else if (command === 'train') await train(argument);
  else if (command === 'reset-registry') await resetTrainedRegistry();
  else if (command === 'record') await recordRecipe(argument);
  else if (command === 'replay') {
    await replayRecipe(argument, {
      allowSideEffects,
      allowRepeatSideEffects,
    });
  }
  else if (command === 'run') {
    await run(argument, {
      allowSideEffects,
      allowRepeatSideEffects,
    });
  }
  else {
    usage();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

// connectOverCDP keeps a WebSocket alive. Exit disconnects this CLI client
// without calling browser.close(), which would close the user's Chrome window.
process.exit(process.exitCode || 0);
