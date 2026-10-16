const test = require("node:test");
const assert = require("node:assert/strict");

test("toSlimConfig maps store state and strips OpenWhispr cloud mode", async () => {
  const { toSlimConfig, normalizeSlimMode } = await import("../../src/helpers/jsonConfigMap.js");
  assert.equal(normalizeSlimMode("openwhispr"), "providers");
  const cfg = toSlimConfig({
    transcriptionMode: "openwhispr",
    cloudTranscriptionProvider: "custom",
    cloudTranscriptionModel: "gemini/gemini-2.5-flash",
    cloudTranscriptionBaseUrl: "https://litellm.example.com/v1",
    remoteTranscriptionUrl: "",
    customTranscriptionApiKey: "sk-stt",
    groqApiKey: "",
    openaiApiKey: "",
    geminiApiKey: "",
    cleanupMode: "providers",
    cleanupProvider: "custom",
    cleanupModel: "flash-lite",
    cleanupCloudBaseUrl: "https://litellm.example.com/v1",
    cleanupRemoteUrl: "",
    cleanupCustomApiKey: "sk-llm",
    useCleanupModel: true,
    customPrompts: { cleanup: "fix this" },
    dictationKey: "F8",
    customDictionary: ["CONTACT"],
    theme: "auto",
    uiLanguage: "de",
    preferredLanguage: "auto",
  });
  assert.equal(cfg.stt.mode, "providers");
  assert.equal(cfg.stt.apiKey, "sk-stt");
  assert.equal(cfg.cleanup.prompt, "fix this");
  assert.deepEqual(cfg.dictionary, ["CONTACT"]);
});
