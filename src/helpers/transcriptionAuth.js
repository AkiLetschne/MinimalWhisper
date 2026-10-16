import { isOrukeetEndpoint, isSelfHostedTranscription } from "./selfHostedTranscription.js";

export function shouldSkipTranscriptionApiKey(settings) {
  if (!isSelfHostedTranscription(settings) || isOrukeetEndpoint(settings)) {
    return false;
  }
  // LiteLLM and other authenticated custom servers still need a Bearer token.
  const key = typeof settings?.customTranscriptionApiKey === "string"
    ? settings.customTranscriptionApiKey.trim()
    : "";
  return !key;
}
