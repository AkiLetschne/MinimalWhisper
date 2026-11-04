// Suggests a batch meeting recording when a known meeting app keeps capturing
// the microphone, and suggests stopping it once that app lets go of the
// microphone again. It only ever prompts: starting and stopping stay user
// decisions.
const { execFile } = require("node:child_process");

// Matched against the capturing process' binary (Linux) or a process that only
// runs during a call (Windows). Browsers are left out on purpose: a browser
// holding the mic says nothing about a meeting.
const MEETING_APPS = [
  {
    key: "teams",
    name: "Microsoft Teams",
    linux: ["teams-for-linux", "teams", "teams-insiders", "ms-teams"],
    win32: ["ms-teams_modulehost.exe"],
  },
  { key: "zoom", name: "Zoom", linux: ["zoom", "zoom.real"], win32: ["cpthost.exe"] },
  {
    key: "webex",
    name: "Webex",
    linux: ["webex", "ciscocollabhost"],
    win32: ["webexmeetingsapp.exe"],
  },
  { key: "skype", name: "Skype", linux: ["skypeforlinux"], win32: [] },
];

function matchMeetingApp(binary, platform = "linux") {
  const name = String(binary || "")
    .trim()
    .toLowerCase()
    .split(/[\\/]/)
    .pop();
  if (!name) return null;
  return MEETING_APPS.find((app) => (app[platform] || []).includes(name)) || null;
}

function uniqueApps(binaries, platform) {
  const found = new Map();
  for (const binary of binaries) {
    const app = matchMeetingApp(binary, platform);
    if (app) found.set(app.key, { key: app.key, name: app.name });
  }
  return [...found.values()];
}

// pw-dump lists every PipeWire object. Capture streams are nodes of class
// Stream/Input/Audio; the owning binary sits on the node or on its client.
function parsePwDump(dump) {
  if (!Array.isArray(dump)) throw new Error("pw-dump returned a non-array response");
  const clients = new Map();
  for (const object of dump) {
    if (object?.type === "PipeWire:Interface:Client") clients.set(object.id, object.info?.props);
  }
  const binaries = [];
  for (const object of dump) {
    const props = object?.info?.props;
    if (object?.type !== "PipeWire:Interface:Node" || !props) continue;
    if (props["media.class"] !== "Stream/Input/Audio") continue;
    // A suspended or idle stream is open but not capturing (e.g. a device
    // probe); only a running stream counts as live microphone use.
    if (object.info.state !== "running") continue;
    const client = clients.get(Number(props["client.id"]));
    binaries.push(props["application.process.binary"] || client?.["application.process.binary"]);
  }
  return uniqueApps(binaries, "linux");
}

function parsePactlSourceOutputs(outputs) {
  if (!Array.isArray(outputs)) throw new Error("pactl returned a non-array response");
  return uniqueApps(
    outputs
      .filter((output) => output?.corked !== true)
      .map((output) => output?.properties?.["application.process.binary"]),
    "linux"
  );
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 4000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
}

const missing = (error) => error?.code === "ENOENT";

// Returns the meeting apps currently capturing audio, or null when this
// platform has no way to tell (detection then stays off).
function createCaptureSnapshot({ platform = process.platform, exec = run, getProcessList } = {}) {
  if (platform === "linux") {
    let pwDumpMissing = false;
    let pactlMissing = false;
    return async () => {
      if (!pwDumpMissing) {
        try {
          return parsePwDump(JSON.parse(await exec("pw-dump", ["--no-colors"])));
        } catch (error) {
          if (!missing(error)) throw error;
          pwDumpMissing = true;
        }
      }
      if (!pactlMissing) {
        try {
          return parsePactlSourceOutputs(
            JSON.parse(await exec("pactl", ["--format=json", "list", "source-outputs"]))
          );
        } catch (error) {
          if (!missing(error)) throw error;
          pactlMissing = true;
        }
      }
      return null;
    };
  }
  if (platform === "win32") {
    const list = getProcessList || (() => require("../processListCache").getProcessList());
    return async () => uniqueApps(await list(), "win32");
  }
  // macOS reports microphone use only through the bundled listener helper,
  // and a running meeting app alone is no meeting (FaceTime idles), so there
  // is no trustworthy signal here yet.
  return async () => null;
}

const DEFAULTS = {
  intervalMs: 5000,
  // Long enough to skip device probes and the mic test at call setup.
  sustainMs: 8000,
  // A short gap (device switch, reconnect) still counts as the same meeting.
  endGraceMs: 15000,
  // After this much silence the app may prompt again for its next meeting.
  resetMs: 60000,
  // While recording, this much silence from every meeting app seen during the
  // recording suggests the call is over. Longer than endGraceMs so a device
  // switch or reconnect does not ask to stop.
  endPromptMs: 20000,
};

function createMeetingDetector({
  snapshot,
  isEnabled = () => true,
  isRecording = () => false,
  canPrompt = () => true,
  onPrompt,
  onClear,
  onStart,
  onStop = async () => {},
  log = () => {},
  now = Date.now,
  setInterval: schedule = global.setInterval,
  clearInterval: unschedule = global.clearInterval,
  ...options
}) {
  const timing = { ...DEFAULTS, ...options };
  const apps = new Map(); // key -> { name, firstSeenAt, lastSeenAt, handled }
  let prompt = null; // { id, key, kind: "start" | "end" }
  // Meeting apps seen while the current recording runs: key -> { name, lastSeenAt }.
  let recordingWatch = null; // { seen: Map, prompted: boolean }
  let timer = null;
  let ticking = false;
  let wasRecording = false;
  let unsupported = false;
  let failures = 0;
  let promptCount = 0;

  function clearPrompt(reason) {
    if (!prompt) return;
    const { id } = prompt;
    prompt = null;
    log("info", "Meeting detection prompt cleared", { promptId: id, reason });
    onClear?.({ promptId: id, reason });
  }

  // Everything live right now counts as answered: the user is recording it
  // or has just stopped recording it.
  function settleAll() {
    for (const entry of apps.values()) entry.handled = true;
  }

  async function tick() {
    if (ticking || unsupported) return;
    ticking = true;
    try {
      if (!isEnabled()) {
        clearPrompt("disabled");
        apps.clear();
        return;
      }
      const recording = isRecording();
      if (recording) {
        wasRecording = true;
        if (prompt?.kind === "start") clearPrompt("recording");
        settleAll();
        recordingWatch ||= { seen: new Map(), prompted: false };
      } else if (recordingWatch) {
        recordingWatch = null;
        if (prompt?.kind === "end") clearPrompt("stopped");
      }
      let live;
      try {
        live = await snapshot();
        failures = 0;
      } catch (error) {
        if (failures++ === 0)
          log("warn", "Meeting detection snapshot failed", { error: error.message });
        return;
      }
      if (live === null) {
        unsupported = true;
        stop();
        log("info", "Meeting detection unavailable on this system");
        return;
      }
      // The world may have moved while the snapshot ran.
      if (!isEnabled() || isRecording() !== recording) return;

      const at = now();
      if (recording) {
        watchForEnd(live, at);
        return;
      }
      for (const { key, name } of live) {
        const entry = apps.get(key);
        if (!entry) apps.set(key, { name, firstSeenAt: at, lastSeenAt: at, handled: false });
        else entry.lastSeenAt = at;
      }
      if (wasRecording) {
        // The meeting that was just recorded must not prompt again when the
        // recording ends while the call goes on.
        wasRecording = false;
        settleAll();
      }
      for (const [key, entry] of apps) {
        const silentFor = at - entry.lastSeenAt;
        if (prompt?.key === key && silentFor >= timing.endGraceMs) clearPrompt("ended");
        if (silentFor >= timing.resetMs) apps.delete(key);
      }
      if (prompt) return;
      for (const [key, entry] of apps) {
        if (entry.handled || entry.lastSeenAt !== at || at - entry.firstSeenAt < timing.sustainMs)
          continue;
        if (!canPrompt()) return;
        entry.handled = true;
        prompt = { id: `meeting-${at}-${++promptCount}`, key, kind: "start" };
        log("info", "Meeting detected", { app: key, promptId: prompt.id });
        onPrompt({ promptId: prompt.id, appKey: key, appName: entry.name, kind: "start" });
        return;
      }
    } finally {
      ticking = false;
    }
  }

  // Suggests stopping once every meeting app seen during this recording has
  // been silent for endPromptMs. A recording no meeting app took part in (an
  // in-person meeting) never asks. If the call comes back, the suggestion is
  // withdrawn and may come again after the next silence.
  function watchForEnd(live, at) {
    const watch = recordingWatch;
    if (!watch) return;
    for (const { key, name } of live) watch.seen.set(key, { name, lastSeenAt: at });
    if (live.length > 0) {
      if (prompt?.kind === "end") clearPrompt("resumed");
      watch.prompted = false;
      return;
    }
    if (prompt || watch.prompted || watch.seen.size === 0) return;
    let latestKey = null;
    let latest = null;
    for (const [key, entry] of watch.seen) {
      if (!latest || entry.lastSeenAt > latest.lastSeenAt) {
        latestKey = key;
        latest = entry;
      }
    }
    if (at - latest.lastSeenAt < timing.endPromptMs) return;
    if (!canPrompt()) return;
    watch.prompted = true;
    prompt = { id: `meeting-end-${at}-${++promptCount}`, key: latestKey, kind: "end" };
    log("info", "Meeting end detected", { app: latestKey, promptId: prompt.id });
    onPrompt({ promptId: prompt.id, appKey: latestKey, appName: latest.name, kind: "end" });
  }

  function start() {
    if (timer || unsupported) return;
    timer = schedule(() => void tick(), timing.intervalMs);
    timer?.unref?.();
    void tick();
  }

  function stop() {
    if (timer) unschedule(timer);
    timer = null;
    clearPrompt("stopped");
  }

  async function respond(promptId, action) {
    if (!["start", "stop", "dismiss"].includes(action)) return { success: false, code: "INVALID" };
    if (!prompt || prompt.id !== promptId) return { success: false, code: "STALE" };
    const { key, kind } = prompt;
    if (action === (kind === "end" ? "start" : "stop")) return { success: false, code: "INVALID" };
    prompt = null;
    log("info", "Meeting detection prompt answered", { promptId, action, app: key });
    if (action === "dismiss") return { success: true };
    if (action === "stop") {
      if (!isRecording()) return { success: true, alreadyStopped: true };
      await onStop();
      return { success: true };
    }
    if (isRecording()) return { success: true, alreadyRecording: true };
    await onStart();
    return { success: true };
  }

  // A recording started any other way (hotkey, panel) answers the start
  // prompt; one stopped any other way answers the end prompt.
  function recordingChanged(active) {
    if (!active) {
      recordingWatch = null;
      if (prompt?.kind === "end") clearPrompt("stopped");
      return;
    }
    wasRecording = true;
    if (prompt?.kind === "start") clearPrompt("recording");
    settleAll();
  }

  return {
    start,
    stop,
    tick,
    respond,
    recordingChanged,
    getPrompt: () => (prompt ? { ...prompt } : null),
  };
}

module.exports = {
  MEETING_APPS,
  matchMeetingApp,
  parsePwDump,
  parsePactlSourceOutputs,
  createCaptureSnapshot,
  createMeetingDetector,
};
