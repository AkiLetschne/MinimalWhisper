#!/usr/bin/env node

// Builds linux-fast-paste.c under its own name, for the input-region server only.
// Without linux-fast-paste beside it, pasting keeps using the system tools.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "linux") process.exit(0);

const resources = path.resolve(__dirname, "..", "resources");
const output = path.join(resources, "bin", "linux-input-region");
fs.mkdirSync(path.dirname(output), { recursive: true });

const { status } = spawnSync(
  "gcc",
  [
    "-O2",
    path.join(resources, "linux-fast-paste.c"),
    "-o",
    output,
    "-lX11",
    "-lXtst",
    "-lXext",
    "-lm",
  ],
  { stdio: "inherit" }
);

if (status !== 0) {
  console.error("[linux-input-region] Build failed. Install gcc, libx11-dev and libxtst-dev.");
  process.exit(1);
}
