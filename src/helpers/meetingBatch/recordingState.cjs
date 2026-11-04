function createRecordingState(notify, onOwnerGone = () => {}) {
  let current = null;
  let owner = null;
  let cleanup = null;
  function clear() {
    if (!current) return;
    cleanup?.();
    cleanup = null;
    owner = null;
    current = null;
    notify(null);
  }
  return {
    get: () => current,
    start(sender, state) {
      if (!state || typeof state.id !== "string" || !state.id || !Number.isFinite(state.startedAt))
        throw new Error("Invalid recording state");
      if (current && owner !== sender) throw new Error("A meeting is already recording");
      clear();
      owner = sender;
      current = state;
      const gone = () => {
        clear();
        onOwnerGone();
      };
      const navigation = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) gone();
      };
      sender.once("render-process-gone", gone);
      sender.once("destroyed", gone);
      sender.on("did-start-navigation", navigation);
      cleanup = () => {
        sender.removeListener("render-process-gone", gone);
        sender.removeListener("destroyed", gone);
        sender.removeListener("did-start-navigation", navigation);
      };
      notify(current);
    },
    requestStop(controlPanel) {
      if (!current) return false;
      if (owner !== controlPanel || owner.isDestroyed()) {
        clear();
        onOwnerGone();
        return false;
      }
      try {
        owner.send("meeting-batch-stop-requested");
        return true;
      } catch {
        clear();
        onOwnerGone();
        return false;
      }
    },
    stop(sender) {
      if (owner === sender) clear();
    },
  };
}
module.exports = { createRecordingState };
