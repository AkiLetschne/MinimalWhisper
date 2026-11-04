const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRecordingState } = require("../../src/helpers/meetingBatch/recordingState.cjs");

test("tracks the recording owner and clears it when the renderer disappears", () => {
  const changes = [];
  const state = createRecordingState((value) => changes.push(value));
  const owner = new EventEmitter();
  const other = new EventEmitter();
  const meeting = { id: "meeting-1", startedAt: 123 };
  state.start(owner, meeting);
  assert.deepEqual(state.get(), meeting);
  state.stop(other);
  assert.deepEqual(state.get(), meeting);
  assert.throws(() => state.start(other, meeting));
  owner.emit("render-process-gone");
  assert.equal(state.get(), null);
  assert.deepEqual(changes, [meeting, null]);
  assert.equal(owner.listenerCount("destroyed"), 0);
});

test("ignores in-page and subframe navigation but clears on reload", () => {
  let gone = 0;
  const owner = new EventEmitter();
  const state = createRecordingState(
    () => {},
    () => gone++
  );
  state.start(owner, { id: "meeting-1", startedAt: 123 });
  owner.emit("did-start-navigation", {}, "", true, true);
  owner.emit("did-start-navigation", {}, "", false, false);
  assert.ok(state.get());
  owner.emit("did-start-navigation", {}, "", false, true);
  assert.equal(state.get(), null);
  assert.equal(gone, 1);
});

test("routes stop only to the live control-panel owner and clears stale state", () => {
  const changes = [];
  let gone = 0;
  const state = createRecordingState(
    (value) => changes.push(value),
    () => gone++
  );
  const owner = new EventEmitter();
  const sent = [];
  owner.isDestroyed = () => false;
  owner.send = (channel) => sent.push(channel);
  const meeting = { id: "meeting-1", startedAt: 123 };
  state.start(owner, meeting);
  assert.equal(state.requestStop(owner), true);
  assert.deepEqual(sent, ["meeting-batch-stop-requested"]);
  assert.deepEqual(state.get(), meeting);
  assert.equal(state.requestStop(new EventEmitter()), false);
  assert.equal(state.get(), null);
  assert.equal(gone, 1);
  assert.deepEqual(changes, [meeting, null]);
  assert.equal(state.requestStop(owner), false);
});

test("clears state when the owner's stop message cannot be delivered", () => {
  const state = createRecordingState(() => {});
  const owner = new EventEmitter();
  owner.isDestroyed = () => false;
  owner.send = () => {
    throw new Error("gone");
  };
  state.start(owner, { id: "meeting-1", startedAt: 123 });
  assert.equal(state.requestStop(owner), false);
  assert.equal(state.get(), null);
});
