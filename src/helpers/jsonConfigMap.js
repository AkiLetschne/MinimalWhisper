// Providers with their own stored key (`${provider}ApiKey`); everything else
// (custom, self-hosted) uses the per-pipeline custom key.
const OWN_KEY_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "corti",
  "tinfoil",
  "deepgram",
  "assemblyai",
]);

export function providerKeyField(provider, kind) {
  if (OWN_KEY_PROVIDERS.has(provider)) return `${provider}ApiKey`;
  return kind === "stt" ? "customTranscriptionApiKey" : "cleanupCustomApiKey";
}

function keyFor(provider, slice, kind) {
  return slice[providerKeyField(provider, kind)];
}

export function toSlimConfig(state) {
  const sttMode = state.transcriptionMode === "openwhispr" ? "providers" : state.transcriptionMode;
  const cleanupMode = state.cleanupMode === "openwhispr" ? "providers" : state.cleanupMode;
  return {
    stt: {
      mode: sttMode,
      provider: state.cloudTranscriptionProvider,
      model: state.cloudTranscriptionModel,
      baseUrl:
        sttMode === "self-hosted" ? state.remoteTranscriptionUrl : state.cloudTranscriptionBaseUrl,
      apiKey: keyFor(state.cloudTranscriptionProvider, state, "stt"),
    },
    cleanup: {
      enabled: state.useCleanupModel,
      mode: cleanupMode,
      provider: state.cleanupProvider,
      model: state.cleanupModel,
      baseUrl: cleanupMode === "self-hosted" ? state.cleanupRemoteUrl : state.cleanupCloudBaseUrl,
      apiKey: keyFor(state.cleanupProvider, state, "cleanup"),
      prompt: state.customPrompts?.cleanup || "",
    },
    hotkey: state.dictationKey,
    dictionary: state.customDictionary,
    theme: state.theme,
    uiLanguage: state.uiLanguage,
    preferredLanguage: state.preferredLanguage,
  };
}

export function normalizeSlimMode(mode) {
  if (!mode) return undefined;
  if (mode === "openwhispr" || mode === "enterprise") return "providers";
  return mode;
}
