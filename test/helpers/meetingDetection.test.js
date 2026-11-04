const test = require("node:test");
const assert = require("node:assert/strict");
const {
  matchMeetingApp,
  parsePwDump,
  parsePactlSourceOutputs,
  createCaptureSnapshot,
  createMeetingDetector,
} = require("../../src/helpers/meetingBatch/detection.cjs");
const { createBatchToggle } = require("../../src/helpers/meetingBatch/toggle.cjs");
const { createRecordingState } = require("../../src/helpers/meetingBatch/recordingState.cjs");

const node = (id, props, state = "running") => ({
  id,
  type: "PipeWire:Interface:Node",
  info: { state, props },
});
const client = (id, binary) => ({
  id,
  type: "PipeWire:Interface:Client",
  info: { props: { "application.process.binary": binary } },
});

test("matches meeting binaries per platform, not browsers or partial names", () => {
  assert.equal(matchMeetingApp("teams-for-linux").key, "teams");
  assert.equal(matchMeetingApp("/usr/bin/zoom").key, "zoom");
  assert.equal(matchMeetingApp("Teams-For-Linux").key, "teams");
  assert.equal(matchMeetingApp("MS-Teams_ModuleHost.exe", "win32").key, "teams");
  assert.equal(matchMeetingApp("teams-for-linux", "win32"), null);
  assert.equal(matchMeetingApp("chrome"), null);
  assert.equal(matchMeetingApp("teamspeak"), null);
  assert.equal(matchMeetingApp(""), null);
});

test("pw-dump: only running input streams of meeting apps count", () => {
  const dump = [
    client(112, "teams-for-linux"),
    // Idle client without a stream: Teams is open but not in a call.
    client(113, "helium"),
    node(200, {
      "media.class": "Stream/Input/Audio",
      "application.process.binary": "teams-for-linux",
    }),
    node(201, { "media.class": "Stream/Output/Audio", "application.process.binary": "zoom" }),
    node(
      202,
      { "media.class": "Stream/Input/Audio", "application.process.binary": "zoom" },
      "idle"
    ),
    node(203, { "media.class": "Stream/Input/Audio", "application.process.binary": "helium" }),
    node(204, { "media.class": "Audio/Source", "application.process.binary": "skypeforlinux" }),
  ];
  assert.deepEqual(parsePwDump(dump), [{ key: "teams", name: "Microsoft Teams" }]);
  assert.deepEqual(parsePwDump([client(112, "teams-for-linux")]), []);
});

test("pw-dump: falls back to the owning client's binary and dedupes streams", () => {
  const dump = [
    client(112, "teams-for-linux"),
    node(200, { "media.class": "Stream/Input/Audio", "client.id": "112" }),
    node(201, { "media.class": "Stream/Input/Audio", "client.id": 112 }),
  ];
  assert.deepEqual(parsePwDump(dump), [{ key: "teams", name: "Microsoft Teams" }]);
  assert.throws(() => parsePwDump({}), /non-array/);
});

test("pactl: corked source outputs are ignored", () => {
  const outputs = [
    { corked: true, properties: { "application.process.binary": "zoom" } },
    { corked: false, properties: { "application.process.binary": "teams-for-linux" } },
  ];
  assert.deepEqual(parsePactlSourceOutputs(outputs), [{ key: "teams", name: "Microsoft Teams" }]);
});

test("linux snapshot prefers pw-dump, falls back to pactl, then reports unsupported", async () => {
  const enoent = Object.assign(new Error("missing"), { code: "ENOENT" });
  const calls = [];
  const pwDump = JSON.stringify([
    node(1, { "media.class": "Stream/Input/Audio", "application.process.binary": "zoom" }),
  ]);
  let snapshot = createCaptureSnapshot({
    platform: "linux",
    exec: async (command) => {
      calls.push(command);
      return pwDump;
    },
  });
  assert.deepEqual(await snapshot(), [{ key: "zoom", name: "Zoom" }]);
  assert.deepEqual(calls, ["pw-dump"]);

  calls.length = 0;
  snapshot = createCaptureSnapshot({
    platform: "linux",
    exec: async (command) => {
      calls.push(command);
      if (command === "pw-dump") throw enoent;
      return "[]";
    },
  });
  assert.deepEqual(await snapshot(), []);
  assert.deepEqual(await snapshot(), []);
  // pw-dump is not retried once it is known to be missing.
  assert.deepEqual(calls, ["pw-dump", "pactl", "pactl"]);

  snapshot = createCaptureSnapshot({
    platform: "linux",
    exec: async () => {
      throw enoent;
    },
  });
  assert.equal(await snapshot(), null);

  // A transient failure is an error, not "unsupported".
  snapshot = createCaptureSnapshot({
    platform: "linux",
    exec: async () => {
      throw new Error("timeout");
    },
  });
  await assert.rejects(snapshot(), /timeout/);
});

test("windows snapshot uses in-call processes; macOS has no signal", async () => {
  const win = createCaptureSnapshot({
    platform: "win32",
    getProcessList: async () => ["explorer.exe", "cpthost.exe", "ms-teams.exe"],
  });
  assert.deepEqual(await win(), [{ key: "zoom", name: "Zoom" }]);
  assert.equal(await createCaptureSnapshot({ platform: "darwin" })(), null);
});

function harness(overrides = {}) {
  let clock = 0;
  let live = [];
  const events = [];
  const state = { enabled: true, recording: false, canPrompt: true, starts: 0, stops: 0 };
  const detector = createMeetingDetector({
    snapshot: async () => live,
    isEnabled: () => state.enabled,
    isRecording: () => state.recording,
    canPrompt: () => state.canPrompt,
    onPrompt: (prompt) => events.push(["prompt", prompt]),
    onClear: (payload) => events.push(["clear", payload]),
    onStart: async () => {
      state.starts++;
    },
    onStop: async () => {
      state.stops++;
    },
    now: () => clock,
    setInterval: () => ({}),
    clearInterval: () => {},
    intervalMs: 5000,
    sustainMs: 8000,
    endGraceMs: 15000,
    resetMs: 60000,
    endPromptMs: 20000,
    ...overrides,
  });
  const teams = [{ key: "teams", name: "Microsoft Teams" }];
  const at = async (ms, apps) => {
    clock = ms;
    if (apps) live = apps;
    await detector.tick();
  };
  return {
    detector,
    events,
    state,
    at,
    teams,
    prompts: () => events.filter((e) => e[0] === "prompt"),
  };
}

test("prompts once after sustained capture and not again for the same call", async () => {
  const { events, at, teams, prompts } = harness();
  await at(0, teams);
  await at(5000);
  assert.equal(prompts().length, 0, "brief captures (device probes) do not prompt");
  await at(10000);
  assert.equal(prompts().length, 1);
  assert.deepEqual(prompts()[0][1].appName, "Microsoft Teams");
  for (let t = 15000; t <= 120000; t += 5000) await at(t);
  assert.equal(prompts().length, 1);
  assert.equal(events.length, 1);
});

test("a short capture gap is the same call; a long pause allows the next prompt", async () => {
  const { detector, events, at, teams, prompts } = harness();
  await at(0, teams);
  await at(10000);
  const { promptId } = prompts()[0][1];
  await detector.respond(promptId, "dismiss");
  await at(20000, []);
  await at(30000, teams);
  await at(45000);
  assert.equal(prompts().length, 1, "reconnect within the reset window does not re-prompt");
  await at(50000, []);
  await at(115000);
  await at(120000, teams);
  await at(130000);
  assert.equal(prompts().length, 2);
  assert.equal(events.filter((e) => e[0] === "clear").length, 0);
});

test("prompt is retracted when the call ends", async () => {
  const { events, at, teams } = harness();
  await at(0, teams);
  await at(10000);
  await at(15000, []);
  await at(20000);
  assert.equal(events.length, 1);
  await at(25000);
  assert.deepEqual(events[1][0], "clear");
  assert.equal(events[1][1].reason, "ended");
});

test("start goes through once; stale and repeated answers are rejected", async () => {
  const { detector, state, at, teams, prompts } = harness();
  await at(0, teams);
  await at(10000);
  const { promptId } = prompts()[0][1];
  assert.deepEqual(await detector.respond("other", "start"), { success: false, code: "STALE" });
  assert.deepEqual(await detector.respond(promptId, "bogus"), { success: false, code: "INVALID" });
  assert.deepEqual(await detector.respond(promptId, "start"), { success: true });
  assert.deepEqual(await detector.respond(promptId, "start"), { success: false, code: "STALE" });
  assert.equal(state.starts, 1);
});

test("never prompts while recording and not for the call that was just recorded", async () => {
  const { detector, events, state, at, teams, prompts } = harness();
  state.recording = true;
  await at(0, teams);
  await at(20000);
  assert.equal(prompts().length, 0);
  state.recording = false;
  await at(25000);
  await at(60000);
  assert.equal(prompts().length, 0, "stopping a recording mid-call does not re-prompt");

  // A recording started elsewhere retracts an open prompt.
  await at(70000, []);
  await at(140000);
  await at(145000, [{ key: "zoom", name: "Zoom" }]);
  await at(155000);
  assert.equal(prompts().length, 1);
  detector.recordingChanged(true);
  assert.equal(events.at(-1)[1].reason, "recording");
  state.recording = true;
  assert.deepEqual(await detector.respond(prompts()[0][1].promptId, "start"), {
    success: false,
    code: "STALE",
  });
  assert.equal(state.starts, 0);
});

test("start answered while a recording already runs does not start a second one", async () => {
  const { detector, state, at, teams, prompts } = harness();
  await at(0, teams);
  await at(10000);
  state.recording = true;
  assert.deepEqual(await detector.respond(prompts()[0][1].promptId, "start"), {
    success: true,
    alreadyRecording: true,
  });
  assert.equal(state.starts, 0);
});

test("disabled detection and hidden pill do not prompt; disabling retracts", async () => {
  const { events, state, at, teams, prompts } = harness();
  state.canPrompt = false;
  await at(0, teams);
  await at(10000);
  assert.equal(prompts().length, 0);
  state.canPrompt = true;
  await at(15000);
  assert.equal(prompts().length, 1, "a deferred prompt appears once the pill can show it");
  state.enabled = false;
  await at(20000);
  assert.equal(events.at(-1)[1].reason, "disabled");
});

test("one prompt at a time across several meeting apps", async () => {
  const { at, prompts } = harness();
  const both = [
    { key: "teams", name: "Microsoft Teams" },
    { key: "zoom", name: "Zoom" },
  ];
  await at(0, both);
  await at(10000);
  await at(15000);
  assert.equal(prompts().length, 1);
});

test("unsupported platforms stop polling quietly", async () => {
  let cleared = 0;
  const detector = createMeetingDetector({
    snapshot: async () => null,
    onPrompt: () => assert.fail("must not prompt"),
    setInterval: () => ({}),
    clearInterval: () => cleared++,
  });
  detector.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleared, 1);
});

test("toggle start never stops a recording or cancels a pending start", async () => {
  const messages = [];
  const owner = { send: (channel) => messages.push(channel), isDestroyed: () => false };
  owner.once = owner.on = owner.removeListener = () => {};
  const panel = { webContents: owner, isDestroyed: () => false };
  const state = createRecordingState(() => {});
  const toggle = createBatchToggle({ recordingState: state, getPanel: () => panel });
  // Renderer not ready yet: the start is pending.
  assert.equal(await toggle.start(), true);
  assert.equal(await toggle.start(), false);
  toggle.rendererReady(owner);
  assert.deepEqual(messages, ["meeting-batch-start-requested"]);
  state.start(owner, { id: "x", startedAt: 1 });
  assert.equal(await toggle.start(), false);
  assert.deepEqual(messages, ["meeting-batch-start-requested"]);
});

test("asks to stop once the recorded call goes quiet; stop goes through once", async () => {
  const { detector, state, at, teams, prompts } = harness();
  state.recording = true;
  await at(0, teams);
  await at(60000);
  await at(65000, []);
  await at(75000);
  assert.equal(prompts().length, 0, "a short silence (device switch) does not ask");
  await at(80000);
  assert.equal(prompts().length, 1);
  const end = prompts()[0][1];
  assert.equal(end.kind, "end");
  assert.equal(end.appName, "Microsoft Teams");
  for (let t = 90000; t <= 200000; t += 5000) await at(t);
  assert.equal(prompts().length, 1, "asks once per silence");
  assert.deepEqual(await detector.respond(end.promptId, "start"), {
    success: false,
    code: "INVALID",
  });
  assert.deepEqual(await detector.respond(end.promptId, "stop"), { success: true });
  assert.deepEqual(await detector.respond(end.promptId, "stop"), {
    success: false,
    code: "STALE",
  });
  assert.equal(state.stops, 1);
  assert.equal(state.starts, 0);
});

test("a recording no meeting app took part in never asks to stop", async () => {
  const { state, at, prompts } = harness();
  state.recording = true;
  for (let t = 0; t <= 300000; t += 5000) await at(t, []);
  assert.equal(prompts().length, 0);
});

test("the end prompt is withdrawn when the call comes back and may ask again later", async () => {
  const { detector, events, state, at, teams, prompts } = harness();
  state.recording = true;
  await at(0, teams);
  await at(10000, []);
  await at(30000);
  assert.equal(prompts().length, 1);
  await at(35000, teams);
  assert.equal(events.at(-1)[0], "clear");
  assert.equal(events.at(-1)[1].reason, "resumed");
  await at(40000, []);
  await at(60000);
  assert.equal(prompts().length, 2);
  // Dismissing keeps the recording and does not ask again for this silence.
  assert.deepEqual(await detector.respond(prompts()[1][1].promptId, "dismiss"), {
    success: true,
  });
  for (let t = 65000; t <= 200000; t += 5000) await at(t);
  assert.equal(prompts().length, 2);
  assert.equal(state.stops, 0);
});

test("stopping the recording another way withdraws the end prompt", async () => {
  const { detector, events, state, at, teams, prompts } = harness();
  state.recording = true;
  await at(0, teams);
  await at(10000, []);
  await at(30000);
  assert.equal(prompts().length, 1);
  state.recording = false;
  detector.recordingChanged(false);
  assert.equal(events.at(-1)[1].reason, "stopped");
  assert.deepEqual(await detector.respond(prompts()[0][1].promptId, "stop"), {
    success: false,
    code: "STALE",
  });
  assert.equal(state.stops, 0);
  // Nor does the next recording inherit the last one's meeting.
  state.recording = true;
  for (let t = 35000; t <= 200000; t += 5000) await at(t);
  assert.equal(prompts().length, 1);
});
