const test = require("node:test");
const assert = require("node:assert/strict");
const { createBatchToggle } = require("../../src/helpers/meetingBatch/toggle.cjs");
const { createRecordingState } = require("../../src/helpers/meetingBatch/recordingState.cjs");
const { EventEmitter } = require("node:events");

test("starts on the ready panel and stops only on the recording owner", async () => {
  const messages = [];
  const owner = new EventEmitter();
  owner.isDestroyed = () => false;
  owner.send = (channel) => messages.push(channel);
  const panel = { webContents: owner, isDestroyed: () => false };
  const state = createRecordingState(() => {});
  const toggle = createBatchToggle({ recordingState: state, getPanel: () => panel });
  toggle.rendererReady(owner);
  await toggle.toggle();
  state.start(owner, { id: "x", startedAt: 1 });
  await toggle.toggle();
  assert.deepEqual(messages, ["meeting-batch-start-requested", "meeting-batch-stop-requested"]);
});

test("queues until the correct renderer is ready and cancels a second pending toggle", async () => {
  const messages = [];
  const sender = { send: (channel) => messages.push(channel) };
  let panel;
  const state = createRecordingState(() => {});
  const toggle = createBatchToggle({
    recordingState: state,
    getPanel: () => panel,
    createPanel: async () => {
      panel = { webContents: sender, isDestroyed: () => false };
    },
  });
  await toggle.toggle();
  toggle.rendererReady({
    send() {
      throw new Error("wrong renderer");
    },
  });
  assert.deepEqual(messages, []);
  toggle.rendererReady(sender);
  assert.deepEqual(messages, ["meeting-batch-start-requested"]);
  toggle.rendererGone(sender);
  await toggle.toggle();
  await toggle.toggle();
  toggle.rendererReady(sender);
  assert.equal(messages.length, 1);
});
