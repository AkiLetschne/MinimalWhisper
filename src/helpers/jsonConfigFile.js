const fs = require("fs");
const os = require("os");
const path = require("path");

const JSON_CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "minimal-whispr"
);
const JSON_CONFIG_PATH = path.join(JSON_CONFIG_DIR, "config.json");

function ensureDir() {
  fs.mkdirSync(JSON_CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function readJsonConfig() {
  try {
    const raw = fs.readFileSync(JSON_CONFIG_PATH, "utf8");
    const data = JSON.parse(raw);
    return { path: JSON_CONFIG_PATH, data: data && typeof data === "object" ? data : {} };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: JSON_CONFIG_PATH, data: null };
    }
    throw error;
  }
}

function writeJsonConfig(data) {
  ensureDir();
  const tmp = `${JSON_CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, JSON_CONFIG_PATH);
  try {
    fs.chmodSync(JSON_CONFIG_PATH, 0o600);
  } catch {}
  return { path: JSON_CONFIG_PATH };
}

function watchJsonConfig(onChange) {
  ensureDir();
  let timer = null;
  const watcher = fs.watch(JSON_CONFIG_DIR, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  });
  watcher.unref?.();
  return watcher;
}

module.exports = {
  JSON_CONFIG_PATH,
  readJsonConfig,
  writeJsonConfig,
  watchJsonConfig,
};
