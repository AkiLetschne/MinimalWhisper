# Meeting mode for Minimal Whispr — implementation plan

## Goal

Record a meeting (own microphone + PC/system audio), transcribe it afterwards with the
**configured STT provider** (`stt` in `~/.config/minimal-whispr/config.json`, typically a
LiteLLM `custom` endpoint that is batch-only), and produce a structured summary with the
**configured cleanup LLM** (`cleanup` in config.json). Everything lives in a new, small
"Meetings" view.

## Key decision: own batch pipeline, not the upstream meeting stack

Upstream OpenWhispr meeting recording (`src/stores/meetingRecordingStore.ts`,
`MeetingRecordingMount.tsx`, notes UI) only supports **realtime streaming** providers
(`src/helpers/meetingTranscriptionRouting.js` → `MEETING_STREAMING_PROVIDER_IDS` =
openai, assemblyai, deepgram, corti, tinfoil; `self-hosted` throws `unsupportedSelfHosted`;
`custom` is not supported). The fork's real setup uses `provider: "custom"` (LiteLLM,
batch). Re-enabling the upstream notes/meeting UI would therefore not work for the owner and
would expose a large hidden surface (notes, folders, AEC sidecars, diarization, calendar).

So: build a **self-contained batch meeting feature** that *reuses upstream building blocks*
(system-audio access detection, ffmpeg helpers, the BYOK/custom file-transcription route,
the notes DB table, the meeting summary prompt) instead of the upstream meeting store.
Do **not** delete upstream meeting code; leave it hidden.

## Scope (MVP)

### 1. Navigation and config flags
- `src/config/slimFork.ts`: add `"meetings"` to `SLIM_NAV`.
- `src/components/controlPanelNav.ts`: add `ControlPanelView` `"meetings"` with a fitting
  icon from `./icons` and label `t("sidebar.meetings")`.
- `src/components/ControlPanel.tsx`: render a lazy-loaded `MeetingsView` for
  `activeView === "meetings"`. Make sure none of the hidden upstream meeting flows
  (`MeetingRecordingMount`, meeting notifications, `personal-notes` navigation) get
  triggered or become visible because of this.

### 2. Recording (two separate tracks)
- **Mic track:** `getUserMedia` honoring the mic selected in settings (reuse
  `src/helpers/microphoneSelection.js` / `micDeviceSelection.js` logic as dictation does).
- **System track:** use the existing access detection
  (`window.electronAPI.checkSystemAudioAccess()`, `src/utils/systemAudioAccess`,
  `isRendererSystemAudioStrategy`):
  - renderer strategies (`loopback` / `portal`) → `getDisplayMedia` exactly like
    `requestSystemAudioDisplayStream` in `meetingRecordingStore.ts` (extract a shared helper
    if practical rather than copy-pasting);
  - native helper strategies (Linux `linux-system-audio-helper` via
    `linuxPortalAudioManager.js`, macOS audio tap, Windows loopback helper) → main process
    captures PCM and writes it to the track file.
  - Must work on the owner's machine: **Linux, GNOME, Electron with `--ozone-platform=x11`.**
    Find out which strategy is chosen there and make that path solid.
- If system audio is unavailable or fails, keep recording mic-only and show a clear warning
  (and vice versa if the mic fails).
- Tracks are **spooled to disk incrementally** (e.g. MediaRecorder `timeslice` chunks sent via
  IPC and appended; native PCM appended to WAV/raw) under
  `<userData>/meetings/<meetingId>/` (`mic.*`, `system.*`, `meta.json`), so a crash or quit
  does not lose the whole meeting. Validate paths in main (see `ipcSenderGuard.js`,
  `resolveAllowedAudioPath`).
- Live UI while recording: elapsed timer, simple level meter per track, Stop button.
- Dictation (F8) must keep working during a meeting recording and must not break the
  meeting recording.
- Known limitation, document it: no echo cancellation between tracks; with loudspeakers the
  mic also picks up the other participants → recommend headphones. Enable
  `echoCancellation` on the mic constraints anyway.

### 3. Post-processing pipeline (main process, after Stop)
New module(s), e.g. `src/helpers/meetingBatch/` (keep pure logic separate from I/O so it is
unit-testable):

1. **Segmenting** (per track, ffmpeg via `ffmpegUtils.js`): convert to mono 16 kHz, detect
   silences (`silencedetect`) and cut into segments of roughly **20–120 s** at silence
   boundaries (hard cap 120 s). **Skip segments without speech** (silence/near-silence), which
   avoids hallucinated text and saves requests. Keep each segment's start offset.
2. **Transcription:** transcribe every segment through the **same route dictation/upload
   uses for the configured STT provider** (`transcribe-audio-file-byok` in
   `src/helpers/ipcHandlers.js` → `resolveTranscriptionRoute`, `prepareProviderUpload`).
   Extract that core into a reusable function and call it from both places; do not duplicate
   provider logic. Pass the language setting and dictionary/prompt the same way dictation does
   (`sttWhisperPrompt.js`). Small concurrency (2), one retry per segment, abortable.
3. **Merge:** interleave segments of both tracks by start offset into a transcript:
   `[mm:ss] Ich: …` (mic) / `[mm:ss] Andere: …` (system). Labels localized (de/en UI).
4. **Summary:** call the configured **cleanup LLM** (`cleanup.provider/model/baseUrl/apiKey`,
   regardless of `cleanup.enabled`) through the existing reasoning/LLM request path used for
   dictation cleanup. Prompt: base it on upstream's meeting notes template
   (`DETAILED_NOTES_*` in `src/helpers/builtinActions.js` + `SOURCE_FIDELITY_RULE` /
   composition in `src/helpers/templatePrompts.js`): short overview, discussion points,
   decisions, action items with owners (only if stated), open questions, next steps; never
   invent names; answer in the transcript's language; tell the model "Ich" = the user and
   that mic/system audio may overlap (dedupe echoes). Also ask for a short title.
   Allow an override via config `meeting.summaryPrompt`. If the transcript exceeds a size
   threshold, do map-reduce (summarize parts, then merge).
5. **Persist:** store in the existing `notes` table (`src/helpers/database.js`) with
   `note_type = 'meeting'`: `title`, `content` = transcript (markdown), `enhanced_content` =
   summary, `audio_duration_seconds`, `source_file` = meeting folder. Track status in
   `meta.json` (`recording | transcribing | summarizing | done | failed`, error, progress) so
   the UI can show progress and offer **Retry** after failures, and so meetings interrupted by
   an app quit can be resumed/retried on next start.
6. **Audio retention:** default delete the audio after a fully successful run; keep it on
   failure for retry. Config `meeting.keepAudio` (bool) to keep it always.

### 4. Meetings view (`src/components/MeetingsView.tsx` + small subcomponents)
- Start button (with system-audio availability hint), recording state, processing progress
  (stage + segments done/total).
- List of meetings (date, duration, title, status).
- Detail: Summary / Transcript tabs, Copy as Markdown, Export `.md`, Regenerate summary,
  Retry (on failure), Delete (removes DB row and folder after confirmation).
- Match the existing Minimal Whispr UI style (look at `HistoryView.tsx`, `MinimalSettings.tsx`,
  `src/components/ui`).

### 5. Settings + config.json
- Add `meeting.summaryPrompt` (string, empty = default) and `meeting.keepAudio` (bool, default
  false) to the two-way config sync (`src/helpers/jsonConfigMap.js`, `jsonConfigSync.ts`,
  settings store) and to `config.example.json`.
- Small "Meetings" card in the settings UI with these two fields.

### 6. i18n, docs
- Add all new strings to the locales actually used (at least `en` and `de`); follow the
  existing i18n structure in `src/locales`.
- README: update the Scope section (meetings are now supported, batch, how it works, privacy
  note that audio/transcript go to the configured providers, headphone recommendation).

### Out of scope (follow-ups)
Speaker diarization beyond Ich/Andere, realtime transcript, meeting auto-detection, calendar,
tray/hotkey start, AEC.

## Quality bar / verification
- Unit tests (node:test, like existing `test/helpers/*.test.js`) for the pure parts: segment
  planning from silence data, transcript merge/format, prompt building, map-reduce split,
  config mapping of the new keys, status transitions. Add them to `test:ci` in package.json.
- `npm run test:ci`, lint (`npx eslint` on touched files), TypeScript check as the repo does it,
  and `npm run build:renderer` must pass.
- The project needs **Node 24**; system Node may be 22 (tests then fail with
  "X is not a function"). Use a Node 24 binary (nvm, `.nvmrc`, or a tarball). Never rebuild
  `better-sqlite3` for plain Node (it is built for Electron).
- Pipeline smoke test with **synthetic audio only** (e.g. TTS/ffmpeg-generated two-speaker
  files with silence) against the owner's configured providers is allowed.
- Do not kill or restart the owner's running Minimal Whispr instance; never use `pkill`.
- Work on branch `feat/meeting-mode`. Do not commit or push.
