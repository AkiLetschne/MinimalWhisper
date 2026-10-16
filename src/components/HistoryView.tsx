import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import { useUiLocale } from "../hooks/useUiLocale";
import { Button } from "./ui/button";
import { Loader2, Sparkles, X, Trash2, Archive } from "./icons";
import TranscriptionItem from "./ui/TranscriptionItem";
import ThemedEmptyIllustration from "./ui/ThemedEmptyIllustration";
import DictationHotkeyHint from "./ui/DictationHotkeyHint";
import { BIDI_VALUE_TOKEN, BidiInterpolatedText } from "./ui/BidiInterpolatedText";
import historyEmptyLight from "../assets/empty-states/home-history-light.svg";
import historyEmptyDark from "../assets/empty-states/home-history-dark.svg";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatDateGroup } from "../utils/dateFormatting";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";
import { useSettingsStore } from "../stores/settingsStore";
import { effectiveLocalHistoryEnabled } from "../stores/policyRules";
import { usePolicyStore } from "../stores/policyStore";
import { SLIM_NAV } from "../config/slimFork";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onOpenIntegrations: () => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
  userName?: string | null;
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onOpenIntegrations,
  onShowAudioInFolder,
  onRetryTranscription,
  showDiscarded,
  onToggleDiscarded,
  userName,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const locale = useUiLocale();
  const personalDataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const dataRetentionEnabled = usePolicyStore((policyState) =>
    effectiveLocalHistoryEnabled(policyState, personalDataRetentionEnabled)
  );
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();
  const firstName = userName?.trim().split(/\s+/)[0];
  const hasHistory = history.length > 0;

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t, locale);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t, locale]);

  const headerButtonClass =
    "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 transition-colors duration-100";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-5 pb-10">
      <div className="mb-4 flex min-h-7 items-center justify-between gap-4">
        {/* Hidden until the first load settles, so a returning user isn't greeted as new. */}
        <h2
          className={cn(
            "text-[15px] tracking-normal! text-foreground",
            isLoading && !hasHistory && "invisible"
          )}
        >
          {firstName ? (
            <BidiInterpolatedText
              text={t(
                hasHistory
                  ? "controlPanel.history.welcomeBackNamed"
                  : "controlPanel.history.welcomeNamed",
                { name: BIDI_VALUE_TOKEN }
              )}
              value={firstName}
              dir="auto"
            />
          ) : (
            t(hasHistory ? "controlPanel.history.welcomeBack" : "controlPanel.history.welcome")
          )}
        </h2>
        {hasHistory && (
          <div className="-me-2 flex items-center gap-0.5">
            <button onClick={onToggleDiscarded} className={headerButtonClass}>
              <Archive size={13} />
              {showDiscarded
                ? t("controlPanel.history.discarded.hide")
                : t("controlPanel.history.discarded.show")}
            </button>
            <button
              onClick={clearAllTranscriptions}
              className={cn(headerButtonClass, "hover:text-destructive")}
            >
              <Trash2 size={13} />
              {t("controlPanel.history.clearAll")}
            </button>
          </div>
        )}
      </div>
      {!useCleanupModel && !aiCTADismissed && (
        <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
          <button
            onClick={() => {
              localStorage.setItem("aiCTADismissed", "true");
              setAiCTADismissed(true);
            }}
            aria-label={t("common.close")}
            className="absolute top-2 end-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pe-6">
            <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
              <Sparkles size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground mb-0.5">
                {t("controlPanel.aiCta.title")}
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                {t("controlPanel.aiCta.description")}
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onOpenSettings("intelligence")}
              >
                {t("controlPanel.aiCta.enable")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          {!dataRetentionEnabled && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 px-3.5 py-2.5 flex items-center gap-2.5">
              <span className="text-amber-600 dark:text-amber-400 shrink-0 text-sm">⊘</span>
              <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                {t("controlPanel.history.dataRetentionDisabled")}
              </p>
            </div>
          )}
          {isLoading && history.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("controlPanel.loading")}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center px-4 pt-6 text-center">
              <ThemedEmptyIllustration
                light={historyEmptyLight}
                dark={historyEmptyDark}
                width={560}
                height={102}
                className="[mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)]"
              />
              <h2 className="mt-6 text-base text-foreground">{t("controlPanel.history.empty")}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {t("controlPanel.history.emptyDescription")}
              </p>
              <DictationHotkeyHint hotkey={hotkey} className="mt-2" />
            </div>
          ) : (
            <div className="-mx-6">
              {groupedHistory.map((group, index) => (
                <section key={group.label} className={index > 0 ? "mt-3" : undefined}>
                  <h3 className="sticky top-0 z-10 flex h-10 items-end gap-2 border-b border-border-subtle bg-background px-6 pb-2 text-[12px]! font-medium! tracking-normal! text-muted-foreground">
                    {group.label}
                    <span className="tabular-nums text-muted-foreground/60">
                      {group.items.length}
                    </span>
                  </h3>
                  <div className="divide-y divide-border-subtle">
                    {group.items.map((item) => (
                      <TranscriptionItem
                        key={item.id}
                        item={item}
                        onCopy={copyToClipboard}
                        onDelete={deleteTranscription}
                        onShowAudioInFolder={onShowAudioInFolder}
                        onRetryTranscription={onRetryTranscription}
                        onOpenSettings={() => onOpenSettings("transcription")}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* With history, drop the day cards by one date row (pt-2 + text-sm line + pb-2.5) so
            the first one lines up with the first transcription. */}
        {(SLIM_NAV as readonly string[]).includes("integrations") && (
          <div
            className={cn("hidden w-80 shrink-0 md:block", history.length > 0 && "pt-[2.375rem]")}
          >
            <UpcomingMeetings
              events={events}
              isLoading={eventsLoading}
              isConnected={isConnected}
              onConnectCalendar={onOpenIntegrations}
            />
          </div>
        )}
      </div>
    </div>
  );
}
