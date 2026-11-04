import { BUILTIN_ACTIONS, DETAILED_NOTES_KEY } from "../builtinActions.js";
import { compileTemplatePrompt } from "../templatePrompts.js";

// ffmpeg can leave a silence open at EOF without emitting silence_end.
export function parseSilences(output, duration) {
  const intervals = [];
  let start = null;
  for (const line of output.split(/\r?\n/)) {
    const begin = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (begin) start = Number(begin[1]);
    if (end && start !== null) {
      intervals.push({ start, end: Number(end[1]) });
      start = null;
    }
  }
  if (start !== null && Number.isFinite(duration)) intervals.push({ start, end: duration });
  return intervals;
}

// Silence intervals are seconds from the start of the track.
export function planSegments(duration, silences) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const gaps = silences
    .map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(duration, end) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start);
  const speech = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start > cursor) speech.push([cursor, gap.start]);
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < duration) speech.push([cursor, duration]);
  const result = [];
  for (const [index, [start, end]] of speech.entries()) {
    if (
      end - start < 0.3 &&
      (!speech[index - 1] || start - speech[index - 1][1] > 1) &&
      (!speech[index + 1] || speech[index + 1][0] - end > 1)
    )
      continue;
    let pos = start;
    while (pos < end) {
      const previous = result.at(-1);
      if (previous && end - previous.start <= 120 && previous.end - previous.start < 20) {
        previous.end = end;
        break;
      }
      const next = Math.min(end, pos + 120);
      result.push({ start: pos, end: next });
      pos = next;
    }
  }
  return result;
}

export function formatTranscript(segments, language = "en") {
  const labels = language.startsWith("de")
    ? { mic: "Ich", system: "Andere" }
    : { mic: "Me", system: "Others" };
  return [...segments]
    .sort((a, b) => a.start - b.start)
    .filter((s) => s.text?.trim())
    .map((s) => {
      const seconds = Math.max(0, Math.floor(s.start));
      return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}] ${labels[s.track]}: ${s.text.trim()}`;
    })
    .join("\n\n");
}

export function summaryPrompt(override = "") {
  const template = BUILTIN_ACTIONS.find((action) => action.translationKey === DETAILED_NOTES_KEY);
  const prompt = override.trim() ? { prompt: override, sections: [] } : template;
  return `${compileTemplatePrompt(prompt, { isMeetingNote: true })}\n\nStart with a short title on the first line as # <title>. Write the entire response, including the title and all section headings, in the transcript's language, regardless of the language of these instructions or the example headings. For multilingual material, use the predominant spoken language. Preserve proper names and technical terms. Ich/Me means the user. Microphone and system audio may overlap; deduplicate echoes. Never invent names.`;
}

export function splitTranscript(text, limit = 12000) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be positive");
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let end = rest.lastIndexOf("\n", limit);
    if (end < limit / 2) end = rest.lastIndexOf(" ", limit);
    if (end < limit / 2) end = limit;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const transitions = {
  recording: ["transcribing", "failed"],
  transcribing: ["summarizing", "failed"],
  summarizing: ["done", "failed"],
  failed: ["transcribing", "summarizing"],
  done: ["summarizing"],
};
export function transitionStatus(meta, status, updates = {}) {
  if (!transitions[meta.status]?.includes(status))
    throw new Error(`Invalid meeting transition: ${meta.status} -> ${status}`);
  return { ...meta, ...updates, status };
}
