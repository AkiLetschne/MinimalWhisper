const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { EventEmitter } = require("node:events");
const { createAppFrameCheck, installIpcSenderGuard } = require("../../src/helpers/ipcSenderGuard");

const appPath = path.resolve("/opt/minimal-whispr/resources/app.asar");
const rendererUrl = pathToFileURL(path.join(appPath, "src", "dist", "index.html")).href;
const getDevServerUrl = () => "http://localhost:5183/";

test("only the app's renderer page passes in a packaged build", () => {
  const check = createAppFrameCheck({ appPath, getDevServerUrl, isDevelopment: false });

  assert.equal(check(rendererUrl), true);
  assert.equal(check(`${rendererUrl}?panel=true#settings`), true);
  assert.equal(check(pathToFileURL("/tmp/evil.html").href), false);
  assert.equal(check(pathToFileURL(path.join(appPath, "src", "dist", "other.html")).href), false);
  assert.equal(check("http://localhost:5183/"), false);
  assert.equal(check("https://example.com/"), false);
  assert.equal(check(""), false);
  assert.equal(check(undefined), false);
});

test("development also allows the Vite dev server on its own port", () => {
  const check = createAppFrameCheck({ appPath, getDevServerUrl, isDevelopment: true });

  assert.equal(check("http://localhost:5183/?panel=true"), true);
  assert.equal(check("http://127.0.0.1:5183/"), true);
  assert.equal(check("http://localhost:5184/"), false);
  assert.equal(check("http://localhost.evil.com:5183/"), false);
  assert.equal(check(rendererUrl), true);
});

test("guarded handlers refuse unknown or missing sender frames", async () => {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, listener) => handlers.set(channel, listener);
  installIpcSenderGuard(ipcMain, (url) => url === rendererUrl);
  ipcMain.handle("get-secret", (_event, suffix) => `secret${suffix}`);

  const invoke = (event, ...args) => handlers.get("get-secret")(event, ...args);
  assert.equal(await invoke({ senderFrame: { url: rendererUrl } }, "!"), "secret!");
  assert.throws(() => invoke({ senderFrame: { url: "https://example.com/" } }), /refused/);
  assert.throws(() => invoke({ senderFrame: null }), /refused/);
  assert.throws(() => invoke({}), /refused/);
});

test("guarded send listeners drop untrusted messages and stay removable", () => {
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  installIpcSenderGuard(ipcMain, (url) => url === rendererUrl);
  const received = [];
  const listener = (_event, value) => received.push(value);
  ipcMain.on("audio-chunk", listener);

  ipcMain.emit("audio-chunk", { senderFrame: { url: rendererUrl } }, 1);
  ipcMain.emit("audio-chunk", { senderFrame: { url: "https://example.com/" } }, 2);
  ipcMain.emit("audio-chunk", {}, 3);
  ipcMain.emit("audio-chunk", null, 4); // main process re-emitting internally
  assert.deepEqual(received, [1, 4]);

  ipcMain.removeListener("audio-chunk", listener);
  assert.equal(ipcMain.listenerCount("audio-chunk"), 0);
});
