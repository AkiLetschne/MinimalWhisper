/**
 * Whisper `prompt` / keywords[] are OpenAI/Groq STT fields.
 * Custom OpenAI-compat proxies (LiteLLM → Gemini/Vertex) 400 on them.
 */
export function shouldSendWhisperPrompt(provider, model) {
  if (!model || model === "orukeet-v0.1.0") return false;
  if (provider === "custom" || provider === "self-hosted") return false;
  return provider === "openai" || provider === "groq";
}
