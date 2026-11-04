// OpenAI-compatible cleanup endpoints use the same chat-completions protocol as
// the renderer's cleanup provider. Keep the key out of errors and logs.
async function requestSummary(text, systemPrompt, config, signal) {
  const defaults = {
    openai: "https://api.openai.com/v1",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    xai: "https://api.x.ai/v1",
    mistral: "https://api.mistral.ai/v1",
  };
  if (
    !["custom", "openai", "groq", "openrouter", "xai", "mistral"].includes(config.provider) &&
    config.mode !== "self-hosted"
  ) {
    throw new Error("The configured cleanup provider is not supported for meeting summaries");
  }
  if (!["providers", "self-hosted", undefined].includes(config.mode))
    throw new Error("Unsupported cleanup mode for meeting summary");
  if (!config.model) throw new Error("No cleanup model configured");
  const base = (
    config.mode === "self-hosted" || config.provider === "custom"
      ? config.baseUrl || ""
      : defaults[config.provider] || ""
  ).replace(/\/$/, "");
  if (!base) throw new Error("No cleanup endpoint configured");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Cleanup provider returned HTTP ${response.status}`);
  const data = await response.json();
  if (["length", "max_tokens"].includes(data.choices?.[0]?.finish_reason)) {
    throw new Error("Cleanup provider returned a truncated summary");
  }
  const result = data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim())
    throw new Error("Cleanup provider returned an empty response");
  return result;
}
module.exports = { requestSummary };
