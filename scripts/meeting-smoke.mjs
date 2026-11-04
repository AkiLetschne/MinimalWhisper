// Synthetic speech only; reads the owner's existing provider configuration.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { segmentTrack, summarize } = require("../src/helpers/meetingBatch/pipeline.cjs");
const transcribeFile = require("../src/helpers/meetingBatch/transcribe.cjs");
const { requestSummary } = require("../src/helpers/meetingBatch/summary.cjs");
const { providerContentType } = require("../src/helpers/providerUploadAudio.js");
const {
  timestampRequestFields,
  mapVerboseSegments,
} = require("../src/helpers/uploadTimestamps.js");
const { formatTimestamp } = require("../src/helpers/speakerMerge.js");
const errors = require("../src/helpers/providerHttpErrors.js");
const { ipcErrorFields } = require("../src/helpers/ipcErrorFields.js");
const registry = require("../src/models/modelRegistryData.json").transcriptionProviders;
const config = JSON.parse(
  await fs.readFile(path.join(os.homedir(), ".config/minimal-whispr/config.json"), "utf8")
);
const ffmpeg = require("ffmpeg-static");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-smoke-"));
const logger = { debug() {}, warn() {}, error() {} };
const deps = {
  resolvePath: (file) => file,
  prepareProviderUpload: async (file) => ({ path: file, cleanup() {} }),
  transcriptionProviderBaseUrls: () => registry,
  transcriptionProviderName: (id) => registry.find((p) => p.id === id)?.name || id,
  byokSizeCapError: () => "Audio too large",
  providerContentType,
  buildMultipartBody(file, name, contentType, fields) {
    const boundary = "----MeetingSmokeBoundary";
    const parts = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${contentType}\r\n\r\n`
      ),
      file,
      Buffer.from("\r\n"),
    ];
    for (const [key, value] of Object.entries(fields))
      if (value != null)
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
          )
        );
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), boundary };
  },
  async postMultipart(url, body, boundary, headers, { signal } = {}) {
    const response = await fetch(url, {
      method: "POST",
      body,
      signal,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, ...headers },
    });
    const data = await response.json();
    if (!response.ok) {
      const details = JSON.stringify(data).toLowerCase();
      console.error(
        `Transcription HTTP ${response.status}; diagnostic flags: language=${details.includes("language")}, model=${details.includes("model")}, audio=${details.includes("audio")}, auth=${details.includes("auth")}, format=${details.includes("format")}, quota=${details.includes("quota")}`
      );
    }
    return { statusCode: response.status, data };
  },
  debugLogger: logger,
  ...errors,
  ipcErrorFields,
  timestampRequestFields,
  mapVerboseSegments,
  formatDiarTime: formatTimestamp,
  diarizationHost: () => null,
  MISTRAL_TRANSCRIPTION_URL: "https://api.mistral.ai/v1/audio/transcriptions",
  XAI_STT_URL: "https://api.x.ai/v1/stt",
  environmentManager: {},
};
// libespeak-ng is installed even on systems without the command-line frontend.
const python = `import ctypes, sys, wave\nlib=ctypes.CDLL('libespeak-ng.so.1')\nrate=lib.espeak_Initialize(2,0,None,0)\nlib.espeak_SetVoiceByName(b'en')\nchunks=[]\nCALL=ctypes.CFUNCTYPE(ctypes.c_int,ctypes.POINTER(ctypes.c_short),ctypes.c_int,ctypes.c_void_p)\ndef cb(p,n,e):\n if p and n: chunks.append(ctypes.string_at(p,n*2))\n return 0\ncallback=CALL(cb)\nlib.espeak_SetSynthCallback(callback)\nfor text in sys.argv[2:]:\n b=text.encode()+b'\\0'\n lib.espeak_Synth(b,len(b),0,1,0,1,None,None)\n lib.espeak_Synchronize()\n chunks.append(bytes(rate*2))\nwith wave.open(sys.argv[1],'wb') as f:\n f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(b''.join(chunks))\n`;
try {
  const tracks = [
    [
      "mic",
      "Today we are planning the product release for next Friday.",
      "I will prepare the final checklist and share it with the team.",
    ],
    [
      "system",
      "The testing is almost complete, but we still need to resolve the login issue.",
      "Maria will check the remaining bug and report back on Wednesday.",
    ],
  ];
  const segments = [];
  for (const [track, ...utterances] of tracks) {
    const file = path.join(tmp, `${track}.wav`);
    const tts = spawnSync("python3", ["-c", python, file, ...utterances], { encoding: "utf8" });
    if (tts.status !== 0) throw new Error(`Speech synthesis failed: ${tts.stderr}`);
    const result = await segmentTrack({ input: file, directory: tmp, track, ffmpeg });
    for (const segment of result.segments) {
      const stt = config.stt;
      const response = await transcribeFile(
        null,
        {
          filePath: segment.path,
          provider: stt.provider,
          model: stt.model,
          baseUrl: stt.baseUrl,
          apiKey: stt.apiKey,
          transcriptionMode: stt.mode,
          remoteTranscriptionUrl: stt.baseUrl,
          remoteTranscriptionModel: stt.model,
          language: config.preferredLanguage,
          meetingLanguage: true,
        },
        deps
      );
      if (!response.success) throw new Error(response.error);
      segments.push({ ...segment, text: response.text });
    }
  }
  const { formatTranscript } = await import("../src/helpers/meetingBatch/pure.js");
  const transcript = formatTranscript(segments, config.uiLanguage || "en");
  const result = await summarize(transcript, config, requestSummary);
  console.log(`TRANSCRIPT\n${transcript}\n\nSUMMARY\n# ${result.title}\n${result.summary}`);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
