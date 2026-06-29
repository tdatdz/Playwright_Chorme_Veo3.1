const DEFAULT_STYLE_ANALYZER =
  'Analyze the visual DNA of these six reference images, extracting only their shared visual style for image generation. Output ONLY one English prompt (20–50 words). Focus on art style, color palette, lighting, atmosphere, composition, and rendering quality. Merge redundant traits, keep only the most distinctive features. No explanations, bullet points, or markdown. Return exactly one line optimized for AI image generation.';

const DEFAULT_CHARACTER_ANALYZER =
  'Analyze the DNA of this reference image. Extract only the general image style for image generation. Output ONLY one English prompt (20–50 words). Focus on artistic style, color palette, lighting, atmosphere, composition, and render quality. Merge duplicate features, keeping only the most prominent ones. No explanations. No labels. No bullet points. No markdown. Return exactly one line optimized for AI image generation.';

export const DEFAULT_SCRIPT_STUDIO = {
  schemaVersion: 1,
  provider: 'local',
  styleAnalyzer: DEFAULT_STYLE_ANALYZER,
  styleDna:
    'Cinematic editorial illustration, refined color harmony, directional soft light, atmospheric depth, clean composition, highly polished rendering.',
  characterAnalyzer: DEFAULT_CHARACTER_ANALYZER,
  characterDna:
    'One consistent main character with recognizable silhouette, stable facial traits, wardrobe continuity, and expressive but natural body language.',
  filmType: 'Cinematic story',
  language: 'Tiếng Việt',
  preserveScript: true,
  storyMode: false,
  allowText: false,
  targetSceneSeconds: 10,
  story: '',
  masterJson: '',
};

function clean(value, max = 50_000) {
  return String(value || '').trim().slice(0, max);
}

function words(value) {
  return clean(value).split(/\s+/u).filter(Boolean);
}

function splitLongBeat(text, maxWords = 34) {
  const tokens = words(text);
  if (tokens.length <= maxWords) return [text.trim()];
  const chunks = [];
  for (let index = 0; index < tokens.length; index += maxWords) {
    chunks.push(tokens.slice(index, index + maxWords).join(' '));
  }
  return chunks;
}

function storyBeats(story) {
  const normalized = clean(story)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ');
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/u)
    .flatMap((paragraph) =>
      paragraph.split(/(?<=[.!?…])\s+/u),
    )
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => splitLongBeat(item));
}

function secondsFor(text, targetSceneSeconds) {
  const estimated = words(text).length / 2.45 + 1.4;
  const target = Number(targetSceneSeconds) || 10;
  return Number(
    Math.min(16, Math.max(4, (estimated + target) / 2)).toFixed(1),
  );
}

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0',
  )}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function inferEmotion(text, storyMode) {
  const source = text.toLowerCase();
  if (/vui|cười|happy|joy|celebrat/u.test(source)) return 'joyful';
  if (/sợ|kinh dị|dark|fear|danger|horror/u.test(source)) return 'tense';
  if (/buồn|mất|sad|lonely|grief/u.test(source)) return 'melancholic';
  if (/giận|fight|angry|rage/u.test(source)) return 'intense';
  return storyMode ? 'mysterious and compelling' : 'focused and cinematic';
}

function promptSet(beat, input) {
  const visual = clean(input.styleDna, 4_000);
  const character = clean(input.characterDna, 4_000);
  const emotion = inferEmotion(beat, input.storyMode);
  const textRule = input.allowText
    ? 'Legible story-relevant text is allowed when naturally present.'
    : 'No captions, logos, watermarks, or readable text.';
  const storyRule = input.storyMode
    ? 'Narrative folklore atmosphere with symbolic environmental details.'
    : 'Grounded cinematic storytelling with a clear visual action.';
  const shared = [character, visual, storyRule, textRule]
    .filter(Boolean)
    .join(' ');

  return [
    `Single shot illustrating: ${beat} ${shared} Emotion: ${emotion}. Composition: centered main subject, medium shot, clear silhouette and one dominant action.`,
    `Single shot illustrating: ${beat} ${shared} Emotion: ${emotion}. Composition: main subject on the right, contextual environment on the left, medium-wide shot with layered depth.`,
    `Single shot illustrating: ${beat} ${shared} Emotion: ${emotion}. Composition: symbolic detail in the foreground, main subject beyond it, cinematic wide shot and strong visual hierarchy.`,
  ];
}

function motionSet(beat) {
  const subject = beat.split(/[,.!?]/u)[0].trim().slice(0, 90);
  return [
    `main character performs a clear gesture related to ${subject}`,
    'camera makes a slow controlled pan across the environment',
    'subtle environmental motion and a gentle cinematic push-in',
  ];
}

export function normalizeScriptStudio(input = {}) {
  return {
    ...DEFAULT_SCRIPT_STUDIO,
    provider: ['local', 'manual-ai-studio'].includes(input.provider)
      ? input.provider
      : 'local',
    styleAnalyzer:
      clean(input.styleAnalyzer, 8_000) || DEFAULT_STYLE_ANALYZER,
    styleDna: clean(input.styleDna, 8_000),
    characterAnalyzer:
      clean(input.characterAnalyzer, 8_000) ||
      DEFAULT_CHARACTER_ANALYZER,
    characterDna: clean(input.characterDna, 8_000),
    filmType: clean(input.filmType, 120) || 'Cinematic story',
    language: clean(input.language, 80) || 'Tiếng Việt',
    preserveScript: input.preserveScript !== false,
    storyMode: Boolean(input.storyMode),
    allowText: Boolean(input.allowText),
    targetSceneSeconds: Math.min(
      30,
      Math.max(4, Number(input.targetSceneSeconds) || 10),
    ),
    story: clean(input.story, 100_000),
    masterJson: clean(input.masterJson, 500_000),
  };
}

export function buildDirectorInstruction(input) {
  const studio = normalizeScriptStudio(input);
  return [
    'You are an AI film director and storyboard architect.',
    `Analyze the following ${studio.language} story and return ONLY valid JSON.`,
    `Film type: ${studio.filmType}.`,
    `Global visual DNA: ${studio.styleDna || '(infer a consistent visual style)'}`,
    `Character DNA: ${studio.characterDna || '(maintain consistent characters)'}`,
    `Preserve original wording: ${studio.preserveScript}.`,
    `Narrative/folklore mode: ${studio.storyMode}.`,
    `Readable text allowed: ${studio.allowText}.`,
    `Target scene duration: ${studio.targetSceneSeconds} seconds.`,
    'Split the story into chronological scenes. Every scene must contain: scene, srt, duration, timestamp, exactly 3 image prompts, and exactly 3 v2_prompts.',
    'Each image prompt must be a complete English single-shot prompt with one main action, consistent visual DNA, emotion, composition, shot size, and no markdown.',
    'Each v2_prompt must be a short English motion or camera instruction.',
    'Required root schema: {"schemaVersion":1,"project":{},"scenes":[]}.',
    `STORY:\n${studio.story}`,
  ].join('\n');
}

export function compileMasterPrompt(input) {
  const studio = normalizeScriptStudio(input);
  const beats = storyBeats(studio.story);
  if (beats.length === 0) {
    throw new Error('Hãy nhập kịch bản hoặc câu chuyện trước khi biên dịch.');
  }

  let cursor = 0;
  const scenes = beats.map((beat, index) => {
    const duration = secondsFor(beat, studio.targetSceneSeconds);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return {
      scene: index + 1,
      srt: studio.preserveScript ? beat : beat.replace(/\s+/g, ' ').trim(),
      duration,
      timestamp: `${timestamp(start)} → ${timestamp(end)}`,
      prompts: promptSet(beat, studio),
      v2_prompts: motionSet(beat),
    };
  });

  return {
    schemaVersion: 1,
    project: {
      filmType: studio.filmType,
      language: studio.language,
      totalDuration: Number(cursor.toFixed(1)),
      sceneCount: scenes.length,
      visualDna: studio.styleDna,
      characterDna: studio.characterDna,
      modes: {
        preserveScript: studio.preserveScript,
        storyMode: studio.storyMode,
        allowText: studio.allowText,
      },
      compiler: 'local-director-v1',
      requiresAiPolish: studio.language !== 'English',
    },
    scenes,
  };
}

export function validateMasterPrompt(input) {
  const master =
    typeof input === 'string' ? JSON.parse(input) : input;
  if (!master || !Array.isArray(master.scenes) || master.scenes.length === 0) {
    throw new Error('Master JSON phải có mảng scenes không rỗng.');
  }
  const seen = new Set();
  const scenes = master.scenes.map((scene, index) => {
    const number = Number(scene.scene);
    if (!Number.isInteger(number) || number < 1 || seen.has(number)) {
      throw new Error(`Scene ${index + 1} có số thứ tự không hợp lệ.`);
    }
    seen.add(number);
    const prompts = Array.isArray(scene.prompts)
      ? scene.prompts.map((prompt) => clean(prompt, 20_000)).filter(Boolean)
      : [];
    if (prompts.length === 0) {
      throw new Error(`Scene ${number} chưa có prompts.`);
    }
    return {
      scene: number,
      srt: clean(scene.srt, 20_000),
      duration: Number(scene.duration) || 0,
      timestamp: clean(scene.timestamp, 100),
      prompts,
      v2_prompts: Array.isArray(scene.v2_prompts)
        ? scene.v2_prompts
            .map((prompt) => clean(prompt, 4_000))
            .filter(Boolean)
        : [],
    };
  });
  return {
    schemaVersion: 1,
    project:
      master.project && typeof master.project === 'object'
        ? master.project
        : {},
    scenes: scenes.sort((a, b) => a.scene - b.scene),
  };
}
