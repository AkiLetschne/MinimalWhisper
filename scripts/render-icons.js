#!/usr/bin/env node
/**
 * Renders src/assets/logo.svg and logo-mark.svg to the PNG icons the app ships.
 * Run with: npx electron scripts/render-icons.js
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const assets = path.join(__dirname, "..", "src", "assets");
const jobs = [
  ["logo.svg", "icon.png", 1024],
  ["logo-mark.svg", "iconTemplate@3x.png", 48],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const page = path.join(os.tmpdir(), "minimal-whispr-icon.html");
  for (const [source, target, size] of jobs) {
    const svg = fs.readFileSync(path.join(assets, source), "utf8");
    const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    fs.writeFileSync(page, `<body style="margin:0;overflow:hidden">${sized}</body>`);
    win.setContentSize(size, size);
    await win.loadFile(page);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    fs.writeFileSync(path.join(assets, target), image.resize({ width: size, height: size }).toPNG());
    console.log(`${source} -> ${target} (${size}px)`);
  }
  fs.rmSync(page, { force: true });
  app.quit();
});
