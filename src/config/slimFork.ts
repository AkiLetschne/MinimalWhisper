/** What this fork keeps. Everything else stays in the tree but is hidden. */
export const APP_NAME = "Minimal Whispr";

export const SLIM_NAV = ["home", "dictionary"] as const;

export const SLIM_SETTINGS = [
  "general",
  "hotkeys",
  "speechToText",
  "llms",
  "privacyData",
  "system",
] as const;

export const SLIM_SKIP_CLOUD_AUTH = true;

/** Voice assistant, wake word and agent panel are off: dictation only. */
export const SLIM_AGENT = false;
/** Notes search leftover; history is on Home. */
export const SLIM_TOPBAR_SEARCH = false;

export const SLIM_SPEECH_TABS = ["dictation"] as const;
export const SLIM_LLM_TABS = ["dictationCleanup"] as const;

/** Cloud-login and enterprise modes stay out of the pickers. */
export const SLIM_INFERENCE_MODES = ["providers", "self-hosted"] as const;

export type SlimNavId = (typeof SLIM_NAV)[number];
