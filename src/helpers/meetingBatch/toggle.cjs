function createBatchToggle({ recordingState, getPanel, createPanel }) {
  let ready = null;
  let pending = false;
  let creating = null;

  async function requestStart() {
    pending = true;
    let panel = getPanel();
    if (!panel || panel.isDestroyed()) {
      creating ||= Promise.resolve(createPanel()).finally(() => {
        creating = null;
      });
      await creating;
      panel = getPanel();
    }
    if (pending && panel && !panel.isDestroyed() && ready === panel.webContents) {
      pending = false;
      panel.webContents.send("meeting-batch-start-requested");
    }
    return true;
  }

  return {
    async toggle() {
      if (recordingState.get()) {
        pending = false;
        return recordingState.requestStop(getPanel()?.webContents);
      }
      if (pending) {
        pending = false;
        return true;
      }
      return requestStart();
    },
    // Start-only entry (meeting detection prompt): never stops a recording and
    // never cancels a start that is already on its way.
    async start() {
      if (recordingState.get() || pending) return false;
      return requestStart();
    },
    rendererReady(sender) {
      const panel = getPanel();
      if (!panel || panel.isDestroyed() || panel.webContents !== sender) return;
      ready = sender;
      if (pending) {
        pending = false;
        sender.send("meeting-batch-start-requested");
      }
    },
    rendererGone(sender) {
      if (ready === sender) ready = null;
    },
  };
}
module.exports = { createBatchToggle };
