const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/sttWhisperPrompt.js");

test("Groq and OpenAI still send the Whisper prompt", async () => {
  const { shouldSendWhisperPrompt } = await load();
  assert.equal(shouldSendWhisperPrompt("groq", "whisper-large-v3"), true);
  assert.equal(shouldSendWhisperPrompt("openai", "whisper-1"), true);
});

test("custom and self-hosted skip the Whisper prompt (LiteLLM/Gemini)", async () => {
  const { shouldSendWhisperPrompt } = await load();
  assert.equal(shouldSendWhisperPrompt("custom", "gemini/gemini-2.5-flash"), false);
  assert.equal(shouldSendWhisperPrompt("self-hosted", "whisper-1"), false);
});
