const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/meetingBatch/pure.js");

test("parses ffmpeg silence intervals including an open final interval", async () => {
  const { parseSilences } = await load();
  assert.deepEqual(
    parseSilences(
      "silence_start: 0\nsilence_end: 1.25 | silence_duration: 1.25\nsilence_start: 9.5",
      10
    ),
    [
      { start: 0, end: 1.25 },
      { start: 9.5, end: 10 },
    ]
  );
});

test("plans speech only and caps long segments", async () => {
  const { planSegments } = await load();
  assert.deepEqual(
    planSegments(250, [
      { start: 0, end: 10 },
      { start: 230, end: 250 },
    ]),
    [
      { start: 10, end: 130 },
      { start: 130, end: 230 },
    ]
  );
  assert.deepEqual(planSegments(10, [{ start: 0, end: 10 }]), []);
});
test("orders and localizes transcript", async () => {
  const { formatTranscript } = await load();
  assert.equal(
    formatTranscript(
      [
        { start: 61, track: "system", text: " B " },
        { start: 2, track: "mic", text: "A" },
      ],
      "de"
    ),
    "[00:02] Ich: A\n\n[01:01] Andere: B"
  );
});
test("builds prompt and splits long transcripts", async () => {
  const { summaryPrompt, splitTranscript } = await load();
  assert.match(summaryPrompt("Custom"), /Custom/);
  assert.match(summaryPrompt(), /Never invent names/);
  assert.deepEqual(splitTranscript("one two three", 7), ["one two", "three"]);
});
test("unsupported summary provider reports an actionable error", async () => {
  const { requestSummary } = require("../../src/helpers/meetingBatch/summary.cjs");
  await assert.rejects(
    requestSummary("text", "prompt", { provider: "anthropic", mode: "providers" }),
    /configured cleanup provider is not supported for meeting summaries/
  );
});
test("validates status transitions", async () => {
  const { transitionStatus } = await load();
  assert.equal(transitionStatus({ status: "failed" }, "transcribing").status, "transcribing");
  assert.throws(() => transitionStatus({ status: "recording" }, "done"));
});

test("segments long speech, merges nearby speech and drops isolated noise", async () => {
  const { planSegments } = await load();
  assert.deepEqual(planSegments(300, []), [
    { start: 0, end: 120 },
    { start: 120, end: 240 },
    { start: 240, end: 300 },
  ]);
  assert.deepEqual(
    planSegments(30, [
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ]),
    [{ start: 0, end: 30 }]
  );
  assert.deepEqual(
    planSegments(10, [
      { start: 0, end: 4 },
      { start: 5, end: 10 },
    ]),
    [{ start: 4, end: 5 }]
  );
  assert.deepEqual(
    planSegments(5, [
      { start: 1, end: 1.5 },
      { start: 2.5, end: 3.5 },
    ]),
    [{ start: 0, end: 5 }]
  );
  assert.deepEqual(planSegments(2, [{ start: 0.1, end: 2 }]), []);
});

test("summary endpoints follow the selected provider", async () => {
  const { requestSummary } = require("../../src/helpers/meetingBatch/summary.cjs");
  const original = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  };
  try {
    await requestSummary("text", "prompt", {
      provider: "groq",
      model: "m",
      baseUrl: "https://api.openai.com/v1",
    });
    await requestSummary("text", "prompt", {
      provider: "custom",
      model: "m",
      baseUrl: "https://custom.example/v1",
    });
    await requestSummary("text", "prompt", {
      provider: "groq",
      mode: "self-hosted",
      model: "m",
      baseUrl: "https://host.example/v1",
    });
    assert.deepEqual(urls, [
      "https://api.groq.com/openai/v1/chat/completions",
      "https://custom.example/v1/chat/completions",
      "https://host.example/v1/chat/completions",
    ]);
  } finally {
    global.fetch = original;
  }
});

test("uses the detailed meeting template and requests a title", async () => {
  const { summaryPrompt } = await load();
  const prompt = summaryPrompt();
  assert.match(prompt, /# <title>/);
  assert.match(prompt, /action items/i);
  assert.match(prompt, /deduplicate echoes/);
  assert.match(prompt, /transcript's language/);
  assert.match(prompt, /including the title and all section headings/);
  assert.match(prompt, /regardless of the language of these instructions or the example headings/);
  assert.match(prompt, /predominant spoken language/);
});

test("uses the transcript language instruction for each summary and the combined summary", async () => {
  const { summarize } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const calls = [];
  await summarize("Besprechung ".repeat(2500), {}, async (text, prompt) => {
    calls.push({ text, prompt });
    return "# Titel\nZusammenfassung";
  });
  assert.ok(calls.length > 2);
  for (const { prompt } of calls) assert.match(prompt, /including the title and all section headings/);
  assert.match(calls.at(-1).prompt, /Combine these partial summaries/);
});

test("validates meeting IDs, tracks and bounded binary chunks", () => {
  const {
    validateId,
    validateTrack,
    validateChunk,
  } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const { randomUUID } = require("node:crypto");
  assert.equal(validateId(randomUUID()).length, 36);
  for (const id of ["../other", "", null, "00000000-0000-0000-0000-000000000000"])
    assert.throws(() => validateId(id));
  assert.equal(validateTrack("mic"), "mic");
  assert.throws(() => validateTrack("../mic"));
  assert.deepEqual(validateChunk(new Uint8Array([1, 2])), Buffer.from([1, 2]));
  assert.throws(() => validateChunk([]));
  assert.throws(() => validateChunk(new Uint8Array(0)));
  assert.throws(() => validateChunk(new Uint8Array(16 * 1024 * 1024 + 1)));
});

test("meeting storage serializes chunks and recovers interrupted meetings", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-test-"));
  try {
    const batch = createMeetingBatch({ root });
    const meta = await batch.create();
    await Promise.all([
      batch.append(meta.id, "mic", Uint8Array.of(1)),
      batch.append(meta.id, "mic", Uint8Array.of(2)),
    ]);
    assert.deepEqual(await fs.readFile(path.join(root, meta.id, "mic.audio")), Buffer.from([1, 2]));
    await batch.recover();
    const recovered = await batch.get(meta.id);
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.failedStage, "transcribing");
    await assert.rejects(batch.append(meta.id, "mic", Uint8Array.of(3)));
    await batch.delete(meta.id);
    assert.deepEqual(await batch.list(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("raw PCM tracks are decoded and their recording offsets align the transcript", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-pcm-"));
  const ffmpeg = require("ffmpeg-static");
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  let note;
  try {
    const pcm = path.join(root, "test.raw");
    assert.equal(
      spawnSync(ffmpeg, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=500:duration=3",
        "-f",
        "s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        pcm,
      ]).status,
      0
    );
    const batch = createMeetingBatch({
      root,
      ffmpeg,
      getConfig: () => ({}),
      transcribe: async () => "speech",
      requestSummary: async () => "# Test\nSummary",
      database: {
        saveNote: (title, content) => {
          note = { id: 1, title, content };
          return { success: true, note };
        },
        updateNote: () => ({ success: true }),
      },
      notify: (meta) => {
        if (["done", "failed"].includes(meta.status)) finish(meta);
      },
    });
    const meta = await batch.create();
    await batch.append(meta.id, "mic", await fs.readFile(pcm), {
      startedAt: Date.parse(meta.createdAt) + 1000,
      format: { type: "s16le", sampleRate: 16000, channels: 1 },
    });
    await batch.append(meta.id, "system", await fs.readFile(pcm), {
      startedAt: Date.parse(meta.createdAt) + 4500,
      format: { type: "s16le", sampleRate: 16000, channels: 1 },
    });
    await batch.finish(meta.id, { systemAudioAvailable: true });
    const result = await done;
    assert.equal(result.status, "done", result.error);
    assert.match(note.content, /\[00:01\] Me: speech[\s\S]*\[00:04\] Others: speech/);
    assert.equal(result.tracks.system.offsetMs, 4500);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a recording write failure keeps audio and allows retry", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-write-failure-"));
  try {
    const batch = createMeetingBatch({ root });
    const meeting = await batch.create();
    await batch.append(meeting.id, "mic", Uint8Array.of(1));
    await batch.finish(meeting.id, {
      systemAudioAvailable: false,
      recordingError: "Disk write failed",
    });
    const failed = await batch.get(meeting.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.failedStage, "transcribing");
    assert.equal(failed.error, "Disk write failed");
    await fs.access(path.join(root, meeting.id, "mic.audio"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("summary failure retries from the saved transcript and removes audio after success", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-pipeline-test-"));
  const ffmpeg = require("ffmpeg-static");
  let resolveStatus;
  let statusPromise = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  let calls = 0;
  let saved;
  const db = {
    saveNote(title, content, type, source, duration) {
      saved = { id: 7, title, content, type, source, duration };
      return { success: true, note: saved };
    },
    updateNote(_id, updates) {
      Object.assign(saved, updates);
      return { success: true };
    },
  };
  try {
    const wav = path.join(root, "speech.wav");
    const generated = spawnSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=500:duration=3",
      "-y",
      wav,
    ]);
    assert.equal(generated.status, 0);
    const batch = createMeetingBatch({
      root,
      ffmpeg,
      database: db,
      getConfig: () => ({ uiLanguage: "en" }),
      transcribe: async () => {
        calls++;
        return "Hello team";
      },
      requestSummary: async () => {
        if (calls === 1 && !saved) throw new Error("Summary unavailable");
        return "# Planning\nSummary text";
      },
      notify: (meta) => {
        if (["failed", "done"].includes(meta.status)) resolveStatus(meta);
      },
    });
    const meta = await batch.create();
    await batch.append(meta.id, "mic", await fs.readFile(wav));
    await batch.finish(meta.id, { systemAudioAvailable: false });
    const failure = await statusPromise;
    assert.equal(failure.failedStage, "summarizing");
    assert.match((await batch.get(meta.id)).note.content, /Me: Hello team/);
    await new Promise((resolve) => setImmediate(resolve));
    statusPromise = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    // Let the next summary call succeed while verifying STT is not repeated.
    saved = {};
    await batch.retry(meta.id);
    const done = await statusPromise;
    assert.equal(done.status, "done");
    assert.equal(calls, 1);
    assert.equal(saved.title, "Planning");
    assert.equal(saved.enhanced_content, "Summary text");
    assert.match(saved.content, /Me: Hello team/);
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(fs.access(path.join(root, meta.id, "mic.audio")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rereads settings before summary and audio cleanup", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-settings-test-"));
  const ffmpeg = require("ffmpeg-static");
  let config = { meeting: { keepAudio: false }, cleanup: { model: "old" } };
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  try {
    const wav = path.join(root, "speech.wav");
    assert.equal(
      spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=duration=2", "-y", wav]).status,
      0
    );
    const batch = createMeetingBatch({
      root,
      ffmpeg,
      getConfig: () => config,
      transcribe: async () => {
        config = { meeting: { keepAudio: false }, cleanup: { model: "new" } };
        return "hello";
      },
      requestSummary: async (_text, _prompt, cleanup) => {
        assert.equal(cleanup.model, "new");
        config = { ...config, meeting: { keepAudio: true } };
        return "# Title\nSummary";
      },
      database: {
        saveNote: () => ({ success: true, note: { id: 1 } }),
        updateNote: () => ({ success: true }),
      },
      notify: (meta) => {
        if (["done", "failed"].includes(meta.status)) finish(meta);
      },
    });
    const meta = await batch.create();
    await batch.append(meta.id, "mic", await fs.readFile(wav));
    await batch.finish(meta.id, { systemAudioAvailable: false });
    assert.equal((await finished).status, "done");
    await fs.access(path.join(root, meta.id, "mic.audio"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Linux capture drains stdout after exit before stop resolves", async () => {
  const { EventEmitter } = require("node:events");
  const childProcess = require("node:child_process");
  const original = childProcess.spawn;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  childProcess.spawn = () => child;
  const modulePath = require.resolve("../../src/helpers/linuxPortalAudioManager.js");
  delete require.cache[modulePath];
  try {
    const Manager = require(modulePath);
    const manager = new Manager();
    manager.getCapability = async () => ({ available: true, supportsSystemAudio: true });
    manager._prepareBinary = () => "fake";
    const chunks = [];
    const starting = manager.start({ onChunk: (chunk) => chunks.push(chunk.toString()) });
    await new Promise((resolve) => setImmediate(resolve));
    child.stderr.emit("data", Buffer.from('{"type":"start"}\n'));
    await starting;
    let stopped = false;
    const stopping = manager.stop().then(() => {
      stopped = true;
    });
    child.emit("exit", 0, null);
    child.stdout.emit("data", Buffer.from("final"));
    assert.equal(stopped, false);
    child.emit("close", 0, null);
    await stopping;
    assert.deepEqual(chunks, ["final"]);
  } finally {
    childProcess.spawn = original;
    delete require.cache[modulePath];
  }
});

test("native PCM chunk timestamp accounts for its duration and channels", () => {
  const { pcmChunkStartedAt } = require("../../src/helpers/meetingBatch/nativeAudio.cjs");
  assert.equal(pcmChunkStartedAt(10000, 48000, 24000, 1), 9000);
  assert.equal(pcmChunkStartedAt(10000, 48000, 24000, 2), 9500);
});

test("shared file transcription preserves upload defaults and applies meeting dictionary hints", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const transcribe = require("../../src/helpers/meetingBatch/transcribe.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-route-test-"));
  const file = path.join(root, "audio.wav");
  const requests = [];
  const errors = require("../../src/helpers/providerHttpErrors.js");
  const deps = {
    resolvePath: (value) => value,
    prepareProviderUpload: async (value) => ({ path: value, cleanup() {} }),
    transcriptionProviderBaseUrls: () =>
      require("../../src/models/modelRegistryData.json").transcriptionProviders,
    transcriptionProviderName: (value) => value,
    providerContentType: () => "audio/wav",
    buildMultipartBody: (_buffer, _name, _type, fields) => {
      requests.push(fields);
      return { body: Buffer.alloc(0), boundary: "boundary" };
    },
    postMultipart: async () => ({ statusCode: 200, data: { text: "hello" } }),
    debugLogger: { warn() {}, error() {} },
    ...errors,
    ipcErrorFields: (error) => ({ error: error.message }),
  };
  try {
    await fs.writeFile(file, "audio");
    const custom = {
      filePath: file,
      provider: "custom",
      model: "test",
      baseUrl: "https://example.com/v1",
      transcriptionMode: "providers",
      language: "de",
    };
    assert.equal((await transcribe(null, custom, deps)).text, "hello");
    assert.deepEqual(requests.pop(), { model: "test" });
    assert.equal(
      (await transcribe(null, { ...custom, prompt: "Name", meetingLanguage: true }, deps)).text,
      "hello"
    );
    assert.deepEqual(requests.pop(), { model: "test" });
    const openai = {
      filePath: file,
      provider: "openai",
      model: "gpt-transcribe",
      apiKey: "test",
      transcriptionMode: "providers",
      language: "de",
      prompt: "Alice, Bob",
      meetingLanguage: true,
    };
    assert.equal((await transcribe(null, openai, deps)).text, "hello");
    assert.deepEqual(requests.pop(), {
      model: "gpt-transcribe",
      language: "de",
      "keywords[]": ["Alice", "Bob"],
    });
    for (const [language, expected] of [
      ["auto", undefined],
      ["", undefined],
      ["de-DE", "de"],
    ]) {
      assert.equal(
        (await transcribe(null, { ...openai, language, prompt: "" }, deps)).text,
        "hello"
      );
      const fields = requests.pop();
      assert.equal(fields.language, expected);
    }
    let uploads = 0;
    const guarded = {
      ...deps,
      prepareProviderUpload: async () => {
        uploads++;
        throw new Error("unexpected upload");
      },
    };
    for (const transcriptionMode of ["local", "enterprise", "openwhispr", "unknown"]) {
      const result = await transcribe(null, { ...openai, transcriptionMode }, guarded);
      assert.equal(result.success, false);
      assert.equal(result.messageKey, "meetings.unsupportedTranscriptionMode");
    }
    assert.equal(uploads, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cancelling an active transcription aborts it and retains audio for retry", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { createMeetingBatch } = require("../../src/helpers/meetingBatch/pipeline.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-cancel-test-"));
  const ffmpeg = require("ffmpeg-static");
  let started;
  let failed;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const failedPromise = new Promise((resolve) => {
    failed = resolve;
  });
  try {
    const wav = path.join(root, "speech.wav");
    assert.equal(
      spawnSync(ffmpeg, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=500:duration=3",
        "-y",
        wav,
      ]).status,
      0
    );
    const batch = createMeetingBatch({
      root,
      ffmpeg,
      getConfig: () => ({}),
      transcribe: (_file, _config, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true });
          started();
        }),
      notify: (meta) => {
        if (meta.status === "failed") failed(meta);
      },
    });
    const meta = await batch.create();
    await batch.append(meta.id, "mic", await fs.readFile(wav));
    await batch.finish(meta.id, { systemAudioAvailable: false });
    await startedPromise;
    assert.equal(batch.cancel(meta.id).success, true);
    assert.equal((await failedPromise).failedStage, "transcribing");
    await fs.access(path.join(root, meta.id, "mic.audio"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
