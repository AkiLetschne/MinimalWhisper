import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { MarkdownRenderer } from "./ui/MarkdownRenderer";
import {
  startBatchMeeting,
  stopBatchMeeting,
  useBatchMeetingRecording,
} from "../stores/batchMeetingRecording";
import type { BatchMeeting } from "../types/electron";

function duration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function MeetingsView() {
  const { t } = useTranslation();
  const recording = useBatchMeetingRecording();
  const [list, setList] = useState<BatchMeeting[]>([]);
  const [selected, setSelected] = useState<BatchMeeting | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [elapsed, setElapsed] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const refresh = () =>
    window.electronAPI
      .listMeetings()
      .then(setList)
      .catch((e: Error) => setError(e.message));
  const select = (id: string) =>
    window.electronAPI
      .getMeeting(id)
      .then(setSelected)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void refresh();
    void window.electronAPI
      .checkSystemAudioAccess?.()
      .then((access) => setAvailable(access.strategy !== "unsupported"));
    return window.electronAPI.onMeetingProgress((meta) => {
      void refresh();
      if (selected?.id === meta.id) void select(meta.id);
    });
  }, [selected?.id]);
  useEffect(() => {
    if (!recording.id) return;
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - recording.startedAt) / 1000)),
      500
    );
    return () => clearInterval(timer);
  }, [recording.id, recording.startedAt]);
  const action = async (fn: () => Promise<unknown>, refreshSelected = true) => {
    setError("");
    try {
      await fn();
      await refresh();
      if (selected && refreshSelected) await select(selected.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const markdown = selected?.note
    ? `# ${selected.title || t("meetings.title")}\n\n## ${t("meetings.summary")}\n\n${selected.note.enhanced_content || ""}\n\n## ${t("meetings.transcript")}\n\n${selected.note.content || ""}`
    : "";
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("meetings.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {available === null
              ? t("meetings.checking")
              : available
                ? t("meetings.systemAvailable")
                : t("meetings.systemUnavailable")}
          </p>
        </div>
        <Button
          disabled={recording.busy}
          onClick={() => void (recording.id ? stopBatchMeeting() : startBatchMeeting())}
        >
          {recording.id ? t("meetings.stop") : t("meetings.start")}
        </Button>
      </div>
      {recording.id && (
        <div className="rounded-lg border border-border p-4 space-y-2">
          <div className="font-medium">
            {t("meetings.recording")} · {duration(elapsed)}
          </div>
          {(
            [
              ["mic", recording.micLevel],
              ["system", recording.systemLevel],
            ] as const
          ).map(([track, level]) => (
            <div key={track} className="flex items-center gap-3 text-sm">
              <span className="w-24">{t(`meetings.${track}`)}</span>
              <meter className="w-40" min={0} max={1} value={level} />
            </div>
          ))}
        </div>
      )}
      {(recording.warning || error) && (
        <p role="alert" className="text-sm text-destructive">
          {[
            "micUnavailable",
            "systemUnavailable",
            "noAudio",
            "micStopped",
            "systemStopped",
          ].includes(recording.warning)
            ? t(`meetings.${recording.warning}`)
            : recording.warning}{" "}
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(180px,1fr)_2fr]">
        <div className="space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("meetings.empty")}</p>
          )}
          {list.map((item) => (
            <button
              key={item.id}
              onClick={() => void select(item.id)}
              className={`w-full rounded-lg border p-3 text-left hover:bg-muted/40 ${selected?.id === item.id ? "border-primary" : "border-border"}`}
            >
              <div className="font-medium">{item.title || t("meetings.untitled")}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()} ·{" "}
                {duration(item.audioDurationSeconds || 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(`meetings.status.${item.status}`, { defaultValue: item.status })}
                {item.progress?.total ? ` · ${item.progress.done}/${item.progress.total}` : ""}{" "}
                {item.progress?.stage && item.status !== "done"
                  ? `(${t(`meetings.status.${item.progress.stage}`, { defaultValue: item.progress.stage })})`
                  : ""}
              </div>
              {item.error && (
                <div role="alert" className="text-xs text-destructive break-words">
                  {item.errorKey ? t(item.errorKey, { defaultValue: item.error }) : item.error}
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-border p-4 space-y-4">
          {selected ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={tab === "summary" ? "default" : "outline"}
                  onClick={() => setTab("summary")}
                >
                  {t("meetings.summary")}
                </Button>
                <Button
                  size="sm"
                  variant={tab === "transcript" ? "default" : "outline"}
                  onClick={() => setTab("transcript")}
                >
                  {t("meetings.transcript")}
                </Button>
              </div>
              {selected.error && (
                <p role="alert" className="text-destructive text-sm">
                  {selected.errorKey
                    ? t(selected.errorKey, { defaultValue: selected.error })
                    : selected.error}
                </p>
              )}
              <MarkdownRenderer
                content={
                  (tab === "summary" ? selected.note?.enhanced_content : selected.note?.content) ||
                  ""
                }
              />
              <div className="flex flex-wrap gap-2">
                {selected.note && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void action(() => navigator.clipboard.writeText(markdown))}
                    >
                      {t("meetings.copy")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void action(() => window.electronAPI.exportMeeting(selected.id))
                      }
                    >
                      {t("meetings.export")}
                    </Button>
                  </>
                )}
                {selected.status === "done" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action(() => window.electronAPI.regenerateMeetingSummary(selected.id))
                    }
                  >
                    {t("meetings.regenerate")}
                  </Button>
                )}
                {selected.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void action(() => window.electronAPI.retryMeeting(selected.id))}
                  >
                    {t("meetings.retry")}
                  </Button>
                )}
                {["transcribing", "summarizing"].includes(selected.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action(() => window.electronAPI.cancelMeetingProcessing(selected.id))
                    }
                  >
                    {t("meetings.cancel")}
                  </Button>
                )}
                {selected.status !== "recording" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(t("meetings.confirmDelete")))
                        void action(async () => {
                          await window.electronAPI.deleteMeeting(selected.id);
                          setSelected(null);
                        }, false);
                    }}
                  >
                    {t("meetings.delete")}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("meetings.select")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
