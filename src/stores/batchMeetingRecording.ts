import { create } from "zustand";
import { resolvePreferredMicrophone } from "../helpers/microphoneSelection";
import { flushJsonConfig } from "../helpers/jsonConfigSync";
import { useSettingsStore } from "./settingsStore";
import {
  isRendererSystemAudioStrategy,
  getDisplayCaptureModeForStrategy,
} from "../utils/systemAudioAccess";
import { requestSystemAudioDisplayStream } from "../utils/systemAudioDisplayCapture";

type Track = "mic" | "system";
type State = {
  id: string | null;
  startedAt: number;
  busy: boolean;
  warning: string;
  micLevel: number;
  systemLevel: number;
};
export const useBatchMeetingRecording = create<State>(() => ({
  id: null,
  startedAt: 0,
  busy: false,
  warning: "",
  micLevel: 0,
  systemLevel: 0,
}));
let streams: MediaStream[] = [];
let recorders: MediaRecorder[] = [];
let contexts: AudioContext[] = [];
let timers: number[] = [];
let pending = Promise.resolve();
let native = false;
let hasSystem = false;
let writeError = "";
let stopPromise: Promise<void> | null = null;
let starting: Promise<void> | null = null;
let closeRequested = false;
const set = useBatchMeetingRecording.setState;
const warn = (message: string) => set({ warning: message });

function attach(stream: MediaStream, track: Track, id: string) {
  streams.push(stream);
  const context = new AudioContext();
  contexts.push(context);
  const analyser = context.createAnalyser();
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  timers.push(
    window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      set(track === "mic" ? { micLevel: peak } : { systemLevel: peak });
    }, 150)
  );
  const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  recorders.push(recorder);
  const startedAt = Date.now();
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    pending = pending
      .then(async () => {
        const bytes = await event.data.arrayBuffer();
        await window.electronAPI.appendMeetingChunk(id, track, bytes, { startedAt });
      })
      .catch((error: Error) => {
        writeError = error.message;
        warn(error.message);
      });
  };
  recorder.onerror = () => warn(track === "mic" ? "micStopped" : "systemStopped");
  stream.getAudioTracks().forEach((audio) => {
    audio.onended = () => {
      if (track === "system") hasSystem = false;
      warn(track === "mic" ? "micStopped" : "systemStopped");
    };
  });
  recorder.start(3000);
}

export function startBatchMeeting(): Promise<void> {
  if (starting || useBatchMeetingRecording.getState().id) return starting || Promise.resolve();
  starting = (async () => {
    writeError = "";
    set({ busy: true, warning: "" });
    try {
      const meeting = await window.electronAPI.createMeeting();
      set({ id: meeting.id, startedAt: Date.parse(meeting.createdAt) });
      try {
        const resolution = await resolvePreferredMicrophone({
          settings: useSettingsStore.getState(),
        }).catch(() => null);
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              ...(resolution?.device?.deviceId
                ? { deviceId: { exact: resolution.device.deviceId } }
                : {}),
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
        }
        attach(stream, "mic", meeting.id);
      } catch {
        warn("micUnavailable");
      }
      try {
        const access = await window.electronAPI.checkSystemAudioAccess?.();
        if (!access || access.strategy === "unsupported") throw new Error("unavailable");
        if (isRendererSystemAudioStrategy(access.strategy)) {
          const result = await requestSystemAudioDisplayStream(
            getDisplayCaptureModeForStrategy(access.strategy)
          );
          if (!result.stream) throw result.error;
          attach(result.stream, "system", meeting.id);
        } else {
          await window.electronAPI.startMeetingSystemAudio(meeting.id);
          native = true;
        }
        hasSystem = true;
      } catch {
        warn("systemUnavailable");
      }
      if (!recorders.length && !native) {
        await window.electronAPI.deleteMeeting(meeting.id);
        set({ id: null, warning: "noAudio" });
      } else {
        await window.electronAPI.reportBatchMeetingRecording({
          id: meeting.id,
          startedAt: Date.parse(meeting.createdAt),
        });
      }
    } catch (error) {
      warn((error as Error).message);
    } finally {
      set({ busy: false });
    }
  })().finally(() => {
    starting = null;
    if (closeRequested) {
      closeRequested = false;
      void stopBatchMeeting();
    }
  });
  return starting;
}

export function stopBatchMeeting(): Promise<void> {
  if (starting) {
    closeRequested = true;
    return starting;
  }
  if (stopPromise) return stopPromise;
  const id = useBatchMeetingRecording.getState().id;
  if (!id) return Promise.resolve();
  stopPromise = (async () => {
    set({ busy: true });
    try {
      await Promise.all(
        recorders.map(
          (recorder) =>
            new Promise<void>((resolve) => {
              if (recorder.state === "inactive") return resolve();
              recorder.addEventListener("stop", () => resolve(), { once: true });
              recorder.stop();
            })
        )
      );
      streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      timers.forEach(clearInterval);
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
      if (native)
        await window.electronAPI.stopMeetingSystemAudio(id).catch((error: Error) => {
          writeError = error.message;
          warn(error.message);
        });
      await pending;
      await flushJsonConfig();
      await window.electronAPI.finishMeetingRecording(id, {
        systemAudioAvailable: hasSystem,
        ...(writeError ? { recordingError: writeError } : {}),
      });
      set({ id: null, micLevel: 0, systemLevel: 0 });
    } catch (error) {
      warn((error as Error).message);
    } finally {
      await window.electronAPI.reportBatchMeetingRecording(null).catch(() => {});
      set({ id: null, micLevel: 0, systemLevel: 0 });
      streams = [];
      recorders = [];
      contexts = [];
      timers = [];
      native = false;
      hasSystem = false;
      set({ busy: false });
    }
  })().finally(() => {
    stopPromise = null;
  });
  return stopPromise;
}

window.electronAPI?.onMeetingSystemError?.(() => {
  hasSystem = false;
  set({ systemLevel: 0 });
  warn("systemStopped");
});
window.electronAPI?.onMeetingSystemLevel?.((level) => set({ systemLevel: level }));
