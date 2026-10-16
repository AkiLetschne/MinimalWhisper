import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { AlertDialog } from "./ui/dialog";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "./ui/SettingsSection";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import LanguageSelector from "./ui/LanguageSelector";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import LinuxPttSetupInfo from "./ui/LinuxPttSetupInfo";
import PromptStudio from "./ui/PromptStudio";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import InferenceConfigEditor from "./settings/InferenceConfigEditor";
import { Monitor, Moon, Sun } from "./icons";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { useTheme } from "../hooks/useTheme";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useHotkeyModeInfo } from "../hooks/useHotkeyModeInfo";
import { setResolvedLLMConfig, useSettingsStore } from "../stores/settingsStore";
import { validateHotkeyForSlot } from "../utils/hotkeyValidation";
import { getCachedPlatform } from "../utils/platform";
import { formatBytes } from "../utils/formatBytes";
import { cn } from "./lib/utils";

export type MinimalSettingsSection =
  "general" | "hotkeys" | "speechToText" | "llms" | "privacyData" | "system";

const RETENTION_DAYS = [1, 7, 14, 30, 60, 90];

const SELECT_CLASS =
  "h-7 rounded-md border border-border/70 bg-surface-1/80 px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50";

/**
 * This fork has no OpenWhispr subscription and no local models, so both
 * pipelines always run in "providers" (bring your own key) mode.
 */
function ensureProviderMode() {
  const s = useSettingsStore.getState();
  if (s.transcriptionMode !== "providers") s.setTranscriptionMode("providers");
  if (s.cloudTranscriptionMode !== "byok") s.setCloudTranscriptionMode("byok");
  if (s.useLocalWhisper) s.setUseLocalWhisper(false);
  if (s.cleanupMode !== "providers") {
    setResolvedLLMConfig("dictationCleanup", { mode: "providers", cloudMode: "byok" });
  }
}

const noop = () => {};

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const {
    audioCuesEnabled,
    setAudioCuesEnabled,
    pauseMediaOnDictation,
    setPauseMediaOnDictation,
    autoPasteEnabled,
    setAutoPasteEnabled,
    keepTranscriptionInClipboard,
    setKeepTranscriptionInClipboard,
    floatingIconAutoHide,
    setFloatingIconAutoHide,
    startMinimized,
    setStartMinimized,
    preferredLanguage,
    updateTranscriptionSettings,
    microphoneSelectionMode,
    selectedMicDeviceId,
    selectedMicDeviceLabel,
    micWarmHoldSeconds,
    setMicrophoneSelectionMode,
    setSelectedMicDevice,
    setMicWarmHoldSeconds,
  } = useSettings();

  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  useEffect(() => {
    window.electronAPI
      ?.getAutoStartEnabled?.()
      .then((state) => setAutoStart(state.enabled))
      .catch(() => setAutoStart(false));
  }, []);
  const changeAutoStart = async (enabled: boolean) => {
    const result = await window.electronAPI?.setAutoStartEnabled?.(enabled);
    if (!result?.success) return;
    const state = await window.electronAPI?.getAutoStartEnabled?.();
    setAutoStart(state?.enabled ?? enabled);
  };

  const themes = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "auto", icon: Monitor, label: "System" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Dictation" />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow label="Language" description="What you speak. Auto works for mixed use.">
              <LanguageSelector
                value={preferredLanguage}
                onChange={(value) => updateTranscriptionSettings({ preferredLanguage: value })}
              />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Paste automatically"
              description="Insert the text where your cursor is."
            >
              <Toggle checked={autoPasteEnabled} onChange={setAutoPasteEnabled} />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Keep in clipboard"
              description="Leave the last transcript on the clipboard."
            >
              <Toggle
                checked={keepTranscriptionInClipboard}
                onChange={setKeepTranscriptionInClipboard}
              />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Sounds" description="Short tone on start and stop.">
              <Toggle checked={audioCuesEnabled} onChange={setAudioCuesEnabled} />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Pause media" description="Pause music while you dictate.">
              <Toggle checked={pauseMediaOnDictation} onChange={setPauseMediaOnDictation} />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Hide indicator when idle"
              description="Only show the floating pill while recording."
            >
              <Toggle checked={floatingIconAutoHide} onChange={setFloatingIconAutoHide} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      <div>
        <SectionHeader title="Microphone" />
        <SettingsPanel>
          <SettingsPanelRow>
            <MicrophoneSettings
              microphoneSelectionMode={microphoneSelectionMode}
              selectedMicDeviceId={selectedMicDeviceId}
              selectedMicDeviceLabel={selectedMicDeviceLabel}
              micWarmHoldSeconds={micWarmHoldSeconds}
              onSelectionModeChange={setMicrophoneSelectionMode}
              onDeviceSelect={setSelectedMicDevice}
              onMicWarmHoldSecondsChange={setMicWarmHoldSeconds}
            />
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      <div>
        <SectionHeader title="App" />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow label="Theme">
              <div className="inline-flex gap-px rounded-md bg-muted/60 p-0.5 dark:bg-surface-2">
                {themes.map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                      theme === value
                        ? "bg-background text-foreground shadow-sm dark:bg-surface-raised"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Launch at login">
              <Toggle
                checked={Boolean(autoStart)}
                disabled={autoStart === null}
                onChange={changeAutoStart}
              />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Start in tray" description="Don't open this window on launch.">
              <Toggle checked={startMinimized} onChange={setStartMinimized} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>
    </div>
  );
}

function HotkeySection() {
  const { t } = useTranslation();
  const { dictationKey, setDictationKey, activationMode, setActivationMode } = useSettings();
  const { alertDialog, showAlertDialog, hideAlertDialog } = useDialogs();
  const { registerHotkey, isRegistering } = useHotkeyRegistration({
    onSuccess: setDictationKey,
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });
  const { isUsingNativeShortcut, pushToTalkUnavailableReason, linuxInputAccessDenied } =
    useHotkeyModeInfo("settings", dictationKey);
  const isLinux = getCachedPlatform() === "linux";
  const validate = useCallback((hotkey: string) => validateHotkeyForSlot(hotkey, {}, t), [t]);

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          title="Dictation hotkey"
          description="Starts and stops recording from anywhere."
        />
        <SettingsPanel>
          <SettingsPanelRow>
            <HotkeyListInput
              value={dictationKey}
              onChange={(list) => registerHotkey(list)}
              validate={validate}
              disabled={isRegistering}
              maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
              required
            />
          </SettingsPanelRow>
          {(!isUsingNativeShortcut || isLinux) && (
            <SettingsPanelRow>
              <SettingsRow label="Mode" description="Tap to toggle, or hold while speaking.">
                <ActivationModeSelector
                  value={activationMode}
                  onChange={setActivationMode}
                  pushDisabledReason={pushToTalkUnavailableReason ?? undefined}
                />
              </SettingsRow>
              {pushToTalkUnavailableReason && !linuxInputAccessDenied && (
                <p className="mt-2 text-xs text-muted-foreground">{pushToTalkUnavailableReason}</p>
              )}
              {isLinux && (activationMode === "push" || linuxInputAccessDenied) && (
                <LinuxPttSetupInfo isAvailable={!linuxInputAccessDenied} />
              )}
            </SettingsPanelRow>
          )}
        </SettingsPanel>
      </div>
      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />
    </div>
  );
}

function TranscriptionSection() {
  const {
    cloudTranscriptionProvider,
    setCloudTranscriptionProvider,
    cloudTranscriptionModel,
    setCloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    setCloudTranscriptionBaseUrl,
  } = useSettings();

  useEffect(ensureProviderMode, []);

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          title="Transcription"
          description="Speech-to-text provider. Custom takes any OpenAI-compatible endpoint, e.g. LiteLLM."
        />
        <TranscriptionModelPicker
          mode="cloud"
          variant="settings"
          selectedCloudProvider={cloudTranscriptionProvider}
          onCloudProviderSelect={setCloudTranscriptionProvider}
          selectedCloudModel={cloudTranscriptionModel}
          onCloudModelSelect={setCloudTranscriptionModel}
          cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
          setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
          selectedLocalModel=""
          onLocalModelSelect={noop}
          useLocalWhisper={false}
          onModeChange={noop}
        />
      </div>
    </div>
  );
}

function CleanupSection() {
  const { useCleanupModel, updateCleanupSettings } = useSettings();

  useEffect(ensureProviderMode, []);

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          title="Cleanup"
          description="An LLM removes filler words and fixes punctuation before pasting."
        />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow label="Clean up transcripts">
              <Toggle
                checked={useCleanupModel}
                onChange={(value) => updateCleanupSettings({ useCleanupModel: value })}
              />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {useCleanupModel && (
        <>
          <InferenceConfigEditor scope="dictationCleanup" allowedModes={["providers"]} />
          <div className="border-t border-border/70 pt-6">
            <SectionHeader title="Prompt" description="Edit the cleanup prompt and try it out." />
            <PromptStudio />
          </div>
        </>
      )}
    </div>
  );
}

function HistorySection() {
  const {
    dataRetentionEnabled,
    setDataRetentionEnabled,
    transcriptRetentionDays,
    setTranscriptRetentionDays,
    audioRetentionDays,
    setAudioRetentionDays,
    saveDiscardedTranscriptions,
    setSaveDiscardedTranscriptions,
  } = useSettings();
  const [usage, setUsage] = useState({ fileCount: 0, totalBytes: 0 });

  useEffect(() => {
    window.electronAPI
      ?.getAudioStorageUsage?.()
      .then((u) => u && setUsage(u))
      .catch(() => {});
  }, []);

  const clearAudio = async () => {
    await window.electronAPI?.deleteAllAudio?.();
    setUsage({ fileCount: 0, totalBytes: 0 });
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="History" description="Everything stays on this machine." />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label="Save transcripts"
              description="Off: text is pasted, nothing is kept."
            >
              <Toggle checked={dataRetentionEnabled} onChange={setDataRetentionEnabled} />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Delete transcripts after">
              <select
                value={transcriptRetentionDays}
                disabled={!dataRetentionEnabled}
                onChange={(e) => setTranscriptRetentionDays(parseInt(e.target.value, 10))}
                className={SELECT_CLASS}
              >
                <option value={0}>Never</option>
                {RETENTION_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "1 day" : `${d} days`}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Keep audio"
              description="Lets you re-run a transcription from history."
            >
              <select
                value={audioRetentionDays}
                disabled={!dataRetentionEnabled}
                onChange={(e) => setAudioRetentionDays(parseInt(e.target.value, 10))}
                className={SELECT_CLASS}
              >
                <option value={0}>Off</option>
                {RETENTION_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "1 day" : `${d} days`}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Keep cancelled recordings"
              description="Esc still saves the audio so you can recover it."
            >
              <Toggle
                checked={saveDiscardedTranscriptions}
                disabled={!dataRetentionEnabled || audioRetentionDays === 0}
                onChange={setSaveDiscardedTranscriptions}
              />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow
              label="Stored audio"
              description={
                usage.fileCount
                  ? `${usage.fileCount} files · ${formatBytes(usage.totalBytes)}`
                  : "None"
              }
            >
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={usage.fileCount === 0}
                onClick={clearAudio}
              >
                Delete all
              </Button>
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>
    </div>
  );
}

function AboutSection() {
  const [version, setVersion] = useState("");
  const [configPath, setConfigPath] = useState("~/.config/minimal-whispr/config.json");
  const [debug, setDebug] = useState<boolean | null>(null);

  useEffect(() => {
    window.electronAPI
      ?.getAppVersion?.()
      .then((r) => setVersion(r?.version ?? ""))
      .catch(() => {});
    window.electronAPI
      ?.jsonConfigPath?.()
      .then((p) => p && setConfigPath(p))
      .catch(() => {});
    window.electronAPI
      ?.getDebugState?.()
      .then((s) => setDebug(s.enabled))
      .catch(() => {});
  }, []);

  const toggleDebug = async (enabled: boolean) => {
    const result = await window.electronAPI?.setDebugLogging?.(enabled);
    if (result?.success) setDebug(enabled);
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Config file" description="Settings here and the file stay in sync." />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label="config.json"
              description={<span className="font-mono break-all">{configPath}</span>}
            >
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void window.electronAPI?.revealJsonConfig?.()}
              >
                Show
              </Button>
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      <div>
        <SectionHeader title="Troubleshooting" />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label="Debug logging"
              description="Writes detailed logs. Leave off normally."
            >
              <Toggle checked={Boolean(debug)} disabled={debug === null} onChange={toggleDebug} />
            </SettingsRow>
          </SettingsPanelRow>
          <SettingsPanelRow>
            <SettingsRow label="Logs">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void window.electronAPI?.openLogsFolder?.()}
              >
                Open folder
              </Button>
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      <p className="text-xs text-muted-foreground/70">
        Minimal Whispr {version && <span className="font-mono">{version}</span>} · based on
        OpenWhispr (MIT)
      </p>
    </div>
  );
}

export default function MinimalSettings({ section }: { section: MinimalSettingsSection }) {
  switch (section) {
    case "hotkeys":
      return <HotkeySection />;
    case "speechToText":
      return <TranscriptionSection />;
    case "llms":
      return <CleanupSection />;
    case "privacyData":
      return <HistorySection />;
    case "system":
      return <AboutSection />;
    default:
      return <GeneralSection />;
  }
}
