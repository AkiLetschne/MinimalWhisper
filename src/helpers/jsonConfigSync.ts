import { setResolvedLLMConfig, useSettingsStore } from "../stores/settingsStore";
import { normalizeSlimMode, providerKeyField, toSlimConfig } from "./jsonConfigMap";
import type { InferenceMode } from "../types/electron";
import logger from "../utils/logger";

let applying = false;
let lastWritten = "";
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(): SlimConfig {
  return toSlimConfig(useSettingsStore.getState());
}

function setProviderKey(provider: string, key: string, kind: "stt" | "cleanup"): void {
  const field: string = providerKeyField(provider, kind);
  const setterName = `set${field[0].toUpperCase()}${field.slice(1)}`;
  const setter = (useSettingsStore.getState() as unknown as Record<string, unknown>)[setterName];
  if (typeof setter === "function") setter(key);
}

type SlimConfig = {
  stt?: {
    mode?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  cleanup?: {
    enabled?: boolean;
    mode?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    prompt?: string;
  };
  hotkey?: string;
  dictionary?: string[];
  theme?: string;
  uiLanguage?: string;
  preferredLanguage?: string;
};

export function applySlimConfig(cfg: SlimConfig): void {
  if (!cfg || typeof cfg !== "object") return;
  const s = useSettingsStore.getState();
  applying = true;
  try {
    if (cfg.stt) {
      const mode = normalizeSlimMode(cfg.stt.mode);
      if (mode) {
        s.setTranscriptionMode(mode as InferenceMode);
        s.setUseLocalWhisper(mode === "local");
        s.setCloudTranscriptionMode(mode === "openwhispr" ? "openwhispr" : "byok");
      }
      if (cfg.stt.provider) s.setCloudTranscriptionProvider(cfg.stt.provider);
      if (cfg.stt.model) s.setCloudTranscriptionModel(cfg.stt.model);
      if (cfg.stt.baseUrl !== undefined) {
        if (mode === "self-hosted") s.setRemoteTranscriptionUrl(cfg.stt.baseUrl);
        else s.setCloudTranscriptionBaseUrl(cfg.stt.baseUrl);
      }
      if (cfg.stt.apiKey !== undefined) {
        setProviderKey(cfg.stt.provider || s.cloudTranscriptionProvider, cfg.stt.apiKey, "stt");
      }
    }
    if (cfg.cleanup) {
      const mode = normalizeSlimMode(cfg.cleanup.mode);
      if (cfg.cleanup.enabled !== undefined) s.setUseCleanupModel(cfg.cleanup.enabled);
      const patch: Record<string, unknown> = {};
      if (mode) {
        patch.mode = mode;
        patch.cloudMode = mode === "openwhispr" ? "openwhispr" : "byok";
      }
      if (cfg.cleanup.provider) patch.provider = cfg.cleanup.provider;
      if (cfg.cleanup.model) patch.model = cfg.cleanup.model;
      if (cfg.cleanup.baseUrl !== undefined) {
        if (mode === "self-hosted") patch.remoteUrl = cfg.cleanup.baseUrl;
        else patch.cloudBaseUrl = cfg.cleanup.baseUrl;
      }
      if (Object.keys(patch).length) {
        setResolvedLLMConfig(
          "dictationCleanup",
          patch as Parameters<typeof setResolvedLLMConfig>[1]
        );
      }
      if (cfg.cleanup.apiKey !== undefined && cfg.cleanup.provider) {
        setProviderKey(cfg.cleanup.provider, cfg.cleanup.apiKey, "cleanup");
      }
      if (cfg.cleanup.prompt !== undefined) s.setCustomPrompt("cleanup", cfg.cleanup.prompt);
    }
    if (cfg.hotkey !== undefined) s.setDictationKey(cfg.hotkey);
    if (Array.isArray(cfg.dictionary)) s.setCustomDictionary(cfg.dictionary);
    if (cfg.theme === "light" || cfg.theme === "dark" || cfg.theme === "auto") {
      s.setTheme(cfg.theme);
    }
    if (cfg.uiLanguage) s.setUiLanguage(cfg.uiLanguage);
    if (cfg.preferredLanguage) s.setPreferredLanguage(cfg.preferredLanguage);
  } finally {
    applying = false;
    lastWritten = JSON.stringify(snapshot());
  }
}

async function writeNow(): Promise<void> {
  const serialized = JSON.stringify(snapshot());
  if (serialized === lastWritten) return;
  lastWritten = serialized;
  try {
    await window.electronAPI?.writeJsonConfig?.(snapshot());
  } catch (error) {
    logger.warn(
      "Failed to write JSON config",
      { error: error instanceof Error ? error.message : String(error) },
      "settings"
    );
  }
}

export async function startJsonConfigSync(): Promise<string | null> {
  if (!window.electronAPI?.readJsonConfig) return null;

  try {
    const result = await window.electronAPI.readJsonConfig();
    if (result?.data) applySlimConfig(result.data);
    else await writeNow();
    const s = useSettingsStore.getState();
    if (
      s.transcriptionMode === "openwhispr" ||
      (s.transcriptionMode === "self-hosted" && !s.remoteTranscriptionUrl?.trim())
    ) {
      s.setTranscriptionMode("providers");
      s.setCloudTranscriptionMode("byok");
    }
    if (s.cleanupMode === "openwhispr") {
      setResolvedLLMConfig("dictationCleanup", { mode: "providers", cloudMode: "byok" });
    }
  } catch (error) {
    logger.warn(
      "Failed to load JSON config",
      { error: error instanceof Error ? error.message : String(error) },
      "settings"
    );
  }

  useSettingsStore.subscribe(() => {
    if (applying) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void writeNow();
    }, 250);
  });

  window.electronAPI.onJsonConfigChanged?.(() => {
    void window.electronAPI.readJsonConfig?.().then((result) => {
      if (!result?.data) return;
      if (JSON.stringify(result.data) === lastWritten) return;
      applySlimConfig(result.data);
    });
  });

  return window.electronAPI.jsonConfigPath?.() ?? null;
}
