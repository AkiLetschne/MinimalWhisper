const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validateId(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Invalid meeting ID");
  return id;
}
function validateTrack(track) {
  if (track !== "mic" && track !== "system") throw new Error("Invalid meeting track");
  return track;
}
function validateChunk(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes))
    throw new Error("Invalid audio chunk");
  const buffer = Buffer.from(
    bytes instanceof ArrayBuffer ? bytes : bytes.buffer,
    bytes.byteOffset || 0,
    bytes.byteLength
  );
  if (!buffer.length || buffer.length > 16 * 1024 * 1024)
    throw new Error("Invalid audio chunk size");
  return buffer;
}
function checkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
}
function runFfmpeg(ffmpeg, args, signal) {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted)
        return reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`));
      resolve(stderr);
    });
  });
}
async function segmentTrack({ input, directory, track, ffmpeg, signal, format }) {
  const { parseSilences, planSegments } = await import("./pure.js");
  const normalized = path.join(directory, `${track}-normalized.wav`);
  await runFfmpeg(
    ffmpeg,
    [
      "-v",
      "error",
      ...(format?.type === "s16le"
        ? ["-f", "s16le", "-ar", String(format.sampleRate), "-ac", String(format.channels)]
        : []),
      "-i",
      input,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-y",
      normalized,
    ],
    signal
  );
  // PCM16 mono files have 32,000 data bytes per second; read the data chunk rather than relying on container duration metadata.
  const file = await fs.open(normalized, "r");
  let duration;
  try {
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    let offset = 12;
    const chunk = Buffer.alloc(8);
    while (true) {
      const { bytesRead } = await file.read(chunk, 0, 8, offset);
      if (bytesRead !== 8) throw new Error("Invalid WAV output");
      const size = chunk.readUInt32LE(4);
      if (chunk.toString("ascii", 0, 4) === "data") {
        duration = size / 32000;
        break;
      }
      offset += 8 + size + (size % 2);
    }
  } finally {
    await file.close();
  }
  const detection = await runFfmpeg(
    ffmpeg,
    ["-hide_banner", "-i", normalized, "-af", "silencedetect=noise=-40dB:d=0.5", "-f", "null", "-"],
    signal
  );
  const plans = planSegments(duration, parseSilences(detection, duration));
  const segments = [];
  for (const [index, segment] of plans.entries()) {
    const output = path.join(directory, `${track}-segment-${index}.wav`);
    await runFfmpeg(
      ffmpeg,
      [
        "-v",
        "error",
        "-ss",
        String(segment.start),
        "-i",
        normalized,
        "-t",
        String(segment.end - segment.start),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        output,
      ],
      signal
    );
    segments.push({ ...segment, track, path: output });
  }
  return { duration, segments };
}
async function summarize(transcript, config, request, signal, onProgress = () => {}) {
  const { summaryPrompt, splitTranscript } = await import("./pure.js");
  const chunks = splitTranscript(transcript);
  if (!chunks.length) throw new Error("No speech detected");
  const prompt = summaryPrompt(config.meeting?.summaryPrompt || "");
  const summaries = [];
  for (const chunk of chunks) {
    checkAbort(signal);
    summaries.push(await request(chunk, prompt, config.cleanup || {}, signal));
    await onProgress(summaries.length, chunks.length + (chunks.length > 1 ? 1 : 0));
  }
  const result =
    chunks.length > 1
      ? await request(
          summaries.join("\n\n"),
          `${prompt}\nCombine these partial summaries faithfully, removing duplicates.`,
          config.cleanup || {},
          signal
        )
      : summaries[0];
  if (typeof result !== "string" || !result.trim()) throw new Error("Summary was empty");
  const match = result.trim().match(/^#\s+([^\n]+)(?:\n|$)/);
  return {
    title: match?.[1].trim() || "Meeting",
    summary: match ? result.trim().slice(match[0].length).trim() : result.trim(),
  };
}

function createMeetingBatch({
  root,
  ffmpeg,
  getConfig,
  transcribe,
  requestSummary,
  database,
  notify = () => {},
}) {
  const active = new Map();
  const writes = new Map();
  const saves = new Map();
  const starting = new Set();
  const finishing = new Set();
  const dir = (id) => path.join(root, validateId(id));
  async function read(id) {
    return JSON.parse(await fs.readFile(path.join(dir(id), "meta.json"), "utf8"));
  }
  async function save(meta) {
    meta.updatedAt = new Date().toISOString();
    const snapshot = JSON.stringify(meta, null, 2);
    const target = path.join(dir(meta.id), "meta.json");
    const prior = saves.get(meta.id) || Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(`${target}.tmp`, snapshot, { mode: 0o600 });
        await fs.rename(`${target}.tmp`, target);
        notify(JSON.parse(snapshot));
      });
    saves.set(meta.id, next);
    try {
      await next;
    } finally {
      if (saves.get(meta.id) === next) saves.delete(meta.id);
    }
  }
  async function create() {
    const id = randomUUID();
    await fs.mkdir(dir(id), { recursive: true, mode: 0o700 });
    const meta = {
      id,
      status: "recording",
      createdAt: new Date().toISOString(),
      error: null,
      progress: { stage: "recording", done: 0, total: 0 },
      systemAudioAvailable: false,
    };
    await save(meta);
    return meta;
  }
  async function append(id, track, bytes, options = {}) {
    validateId(id);
    validateTrack(track);
    const buffer = validateChunk(bytes);
    if (finishing.has(id)) throw new Error("Meeting is finishing");
    const previous = writes.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const meta = await read(id);
        if (meta.status !== "recording") throw new Error("Meeting is not recording");
        meta.tracks ||= {};
        if (!meta.tracks[track]) {
          const format = options.format || { type: "container" };
          if (
            format.type !== "container" &&
            !(
              format.type === "s16le" &&
              Number.isInteger(format.sampleRate) &&
              format.sampleRate >= 8000 &&
              format.sampleRate <= 192000 &&
              Number.isInteger(format.channels) &&
              format.channels >= 1 &&
              format.channels <= 8
            )
          )
            throw new Error("Invalid track format");
          const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : Date.now();
          meta.tracks[track] = {
            format,
            offsetMs: Math.max(0, startedAt - Date.parse(meta.createdAt)),
          };
          await save(meta);
        }
        await fs.appendFile(path.join(dir(id), `${track}.audio`), buffer, { mode: 0o600 });
      });
    writes.set(id, next);
    try {
      await next;
    } finally {
      if (writes.get(id) === next) writes.delete(id);
    }
    return { success: true };
  }
  async function list() {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const results = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && ID.test(e.name))
        .map(async (e) => {
          try {
            return await read(e.name);
          } catch {
            return null;
          }
        })
    );
    return results.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function process(id, stage) {
    const controller = new AbortController();
    if (active.has(id)) throw new Error("Meeting is already processing");
    active.set(id, controller);
    const signal = controller.signal;
    let meta;
    try {
      meta = await read(id);
      const config = await getConfig();
      let transcript;
      if (stage === "transcribing") {
        meta.status = "transcribing";
        meta.error = null;
        meta.errorKey = null;
        meta.progress = { stage: "segmenting", done: 0, total: 0 };
        await save(meta);
        const tracks = [];
        for (const track of ["mic", "system"]) {
          const input = path.join(dir(id), `${track}.audio`);
          try {
            await fs.access(input);
          } catch (e) {
            if (e.code === "ENOENT") continue;
            throw e;
          }
          const info = meta.tracks?.[track];
          const result = await segmentTrack({
            input,
            directory: dir(id),
            track,
            ffmpeg,
            signal,
            format: info?.format,
          });
          const offset = (info?.offsetMs || 0) / 1000;
          result.segments.forEach((segment) => {
            segment.start += offset;
          });
          result.duration += offset;
          tracks.push(result);
        }
        const segments = tracks.flatMap((track) => track.segments);
        if (!segments.length) throw new Error("No speech detected");
        meta.audioDurationSeconds = Math.max(...tracks.map((track) => track.duration));
        meta.progress = { stage: "transcribing", done: 0, total: segments.length };
        await save(meta);
        let next = 0;
        const work = async () => {
          while (next < segments.length) {
            checkAbort(signal);
            const segment = segments[next++];
            let result;
            for (let attempt = 0; attempt < 2; attempt++) {
              checkAbort(signal);
              try {
                result = await transcribe(segment.path, config, signal);
                break;
              } catch (error) {
                if (attempt || signal.aborted) throw error;
              }
            }
            segment.text = result;
            meta.progress.done++;
            await save(meta);
          }
        };
        const workers = [work(), work()];
        try {
          await Promise.all(workers);
        } catch (error) {
          controller.abort();
          await Promise.allSettled(workers);
          throw error;
        }
        const { formatTranscript } = await import("./pure.js");
        transcript = formatTranscript(segments, config.uiLanguage || "en");
        if (!transcript) throw new Error("Transcription was empty");
        await fs.writeFile(path.join(dir(id), "transcript.md"), transcript, { mode: 0o600 });
      } else transcript = await fs.readFile(path.join(dir(id), "transcript.md"), "utf8");
      checkAbort(signal);
      meta.status = "summarizing";
      meta.error = null;
      meta.errorKey = null;
      meta.progress = { stage: "summarizing", done: 0, total: 1 };
      await save(meta);
      const result = await summarize(
        transcript,
        await getConfig(),
        requestSummary,
        signal,
        async (done, total) => {
          meta.progress = { stage: "summarizing", done, total };
          await save(meta);
        }
      );
      checkAbort(signal);
      if (!meta.noteId && database.getMeetingNoteBySourceFile) {
        const existing = await database.getMeetingNoteBySourceFile(dir(id));
        if (existing) {
          meta.noteId = existing.id;
          await save(meta);
        }
      }
      if (meta.noteId) {
        const updated = await database.updateNote(meta.noteId, {
          title: result.title,
          content: transcript,
          enhanced_content: result.summary,
        });
        if (!updated.success) throw new Error(updated.error || "Could not update meeting note");
      } else {
        const saved = await database.saveNote(
          result.title,
          transcript,
          "meeting",
          dir(id),
          meta.audioDurationSeconds
        );
        if (!saved.success) throw new Error(saved.error || "Could not save meeting note");
        meta.noteId = saved.note.id;
        await save(meta);
        const updated = await database.updateNote(meta.noteId, {
          enhanced_content: result.summary,
        });
        if (!updated.success) throw new Error(updated.error || "Could not save meeting summary");
      }
      if (!(await getConfig()).meeting?.keepAudio) {
        try {
          for (const name of await fs.readdir(dir(id)))
            if (/^(mic|system)(\.audio|-normalized\.wav|-segment-\d+\.wav)$/.test(name)) {
              await fs.rm(path.join(dir(id), name), { force: true });
            }
        } catch {
          meta.audioCleanupError = "Could not remove all audio files";
        }
      }
      meta.title = result.title;
      meta.status = "done";
      meta.error = null;
      meta.completedAt = new Date().toISOString();
      meta.progress = { stage: "done", done: 1, total: 1 };
      await save(meta);
    } catch (error) {
      if (meta) {
        meta.failedStage = meta.status === "summarizing" ? "summarizing" : "transcribing";
        meta.status = "failed";
        meta.error = error.message;
        meta.errorKey = error.messageKey || null;
        await save(meta);
      }
    } finally {
      active.delete(id);
    }
  }
  async function start(id, stage) {
    validateId(id);
    if (active.has(id) || starting.has(id)) throw new Error("Meeting is already processing");
    starting.add(id);
    try {
      const meta = await read(id);
      if (stage === "retry" && meta.status !== "failed") throw new Error("Meeting is not failed");
      if (stage === "regenerate" && meta.status !== "done")
        throw new Error("Meeting is not complete");
      if (stage === "finish" && meta.status !== "recording")
        throw new Error("Meeting is not recording");
      process(
        id,
        stage === "regenerate" || (stage === "retry" && meta.failedStage === "summarizing")
          ? "summarizing"
          : "transcribing"
      ).catch(() => {
        notify({ ...meta, status: "failed", error: "Could not update meeting metadata" });
      });
      return { success: true };
    } finally {
      starting.delete(id);
    }
  }
  return {
    create,
    append,
    list,
    async get(id) {
      const meta = await read(id);
      let note = meta.noteId ? await database.getNote(meta.noteId) : null;
      if (!note) {
        try {
          note = {
            content: await fs.readFile(path.join(dir(id), "transcript.md"), "utf8"),
            enhanced_content: "",
          };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      return { ...meta, note };
    },
    async finish(id, options) {
      if (!options || typeof options.systemAudioAvailable !== "boolean")
        throw new Error("Invalid system audio availability");
      if (
        options.recordingError !== undefined &&
        (typeof options.recordingError !== "string" || options.recordingError.length > 1000)
      )
        throw new Error("Invalid recording error");
      validateId(id);
      if (finishing.has(id)) throw new Error("Meeting is finishing");
      finishing.add(id);
      try {
        await writes.get(id);
        const meta = await read(id);
        if (meta.status !== "recording") throw new Error("Meeting is not recording");
        meta.systemAudioAvailable = options.systemAudioAvailable;
        meta.recordingEndedAt = new Date().toISOString();
        if (options.recordingError) {
          meta.status = "failed";
          meta.failedStage = "transcribing";
          meta.error = options.recordingError;
          await save(meta);
          return { success: true };
        }
        await save(meta);
        return await start(id, "finish");
      } finally {
        finishing.delete(id);
      }
    },
    retry: (id) => start(id, "retry"),
    regenerate: (id) => start(id, "regenerate"),
    cancel(id) {
      validateId(id);
      const controller = active.get(id);
      controller?.abort();
      return { success: Boolean(controller) };
    },
    async delete(id) {
      validateId(id);
      if (active.has(id) || starting.has(id) || finishing.has(id) || writes.has(id))
        throw new Error("Meeting is busy");
      const meta = await read(id);
      if (meta.noteId) {
        const result = await database.deleteNote(meta.noteId);
        if (!result.success) throw new Error(result.error || "Could not delete note");
      }
      await fs.rm(dir(id), { recursive: true });
      return { success: true };
    },
    async recover() {
      for (const meta of await list())
        if (["recording", "transcribing", "summarizing"].includes(meta.status)) {
          meta.failedStage = meta.status === "summarizing" ? "summarizing" : "transcribing";
          meta.status = "failed";
          meta.error = "Interrupted by app shutdown";
          await save(meta);
        }
    },
  };
}
module.exports = {
  createMeetingBatch,
  validateId,
  validateTrack,
  validateChunk,
  segmentTrack,
  summarize,
};
