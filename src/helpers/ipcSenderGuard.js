const path = require("path");
const { pathToFileURL } = require("url");

// Every window loads the same renderer page: the built index.html, or the Vite
// dev server in development. Anything else (a destroyed frame, a page the app
// never loads) gets no access to main-process handlers, which hand out API keys.
// The dev server URL is read lazily: its port can come from .env files that
// load after this guard is installed.
function createAppFrameCheck({ appPath, getDevServerUrl, isDevelopment }) {
  const rendererFile = pathToFileURL(path.join(appPath, "src", "dist", "index.html")).href;
  let devOrigins = null;
  const getDevOrigins = () => {
    if (!devOrigins) {
      const port = new URL(getDevServerUrl()).port;
      devOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
    }
    return devOrigins;
  };

  return (url) => {
    if (typeof url !== "string" || !url) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol === "file:") return `file://${parsed.pathname}` === rendererFile;
    return isDevelopment && getDevOrigins().has(parsed.origin);
  };
}

function installIpcSenderGuard(ipcMain, isAppFrameUrl) {
  const isTrusted = (event) => isAppFrameUrl(event?.senderFrame?.url);

  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!isTrusted(event)) {
        throw new Error(`IPC "${channel}" refused: sender is not an app window`);
      }
      return listener(event, ...args);
    });

  // Fire-and-forget messages are dropped instead. A null event is the main
  // process itself re-emitting (ipcMain.emit("hotkey-changed", null, ...)); real
  // IPC always carries an event. The wrapper is remembered per listener so
  // removeListener() with the original function keeps working.
  const wrapped = new WeakMap();
  const wrap = (listener) => {
    if (!wrapped.has(listener)) {
      wrapped.set(listener, function guardedListener(event, ...args) {
        if (event == null || isTrusted(event)) return listener.call(this, event, ...args);
      });
    }
    return wrapped.get(listener);
  };
  const on = ipcMain.on.bind(ipcMain);
  const removeListener = ipcMain.removeListener.bind(ipcMain);
  ipcMain.on = ipcMain.addListener = (channel, listener) => on(channel, wrap(listener));
  ipcMain.removeListener = ipcMain.off = (channel, listener) =>
    removeListener(channel, wrapped.get(listener) ?? listener);
}

module.exports = { createAppFrameCheck, installIpcSenderGuard };
