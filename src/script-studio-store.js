import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_SCRIPT_STUDIO,
  normalizeScriptStudio,
} from './script-director.js';

export const SCRIPT_STUDIO_PATH = path.resolve(
  'artifacts',
  'script-studio',
  'project.json',
);

export async function loadScriptStudio() {
  try {
    return normalizeScriptStudio(
      JSON.parse(await fs.readFile(SCRIPT_STUDIO_PATH, 'utf8')),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveScriptStudio(DEFAULT_SCRIPT_STUDIO);
    return { ...DEFAULT_SCRIPT_STUDIO };
  }
}

export async function saveScriptStudio(input) {
  const studio = normalizeScriptStudio(input);
  await fs.mkdir(path.dirname(SCRIPT_STUDIO_PATH), {
    recursive: true,
  });
  await fs.writeFile(
    SCRIPT_STUDIO_PATH,
    `${JSON.stringify(studio, null, 2)}\n`,
    'utf8',
  );
  return studio;
}
