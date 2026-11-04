import { useCallback, useEffect, useRef, useState } from "react";

// Covers the prompt's collapse back into the pill (dictation-panel.css):
// width 60+260ms, then the logo's return, 240+140ms.
export const MEETING_PROMPT_EXIT_MS = 400;

export type MeetingPromptAction = "start" | "stop" | "dismiss";
export type MeetingPromptLeaving = false | MeetingPromptAction | "cleared";

export interface MeetingPromptDisplay {
  promptId: string;
  appName: string;
  /** "start" offers to record a detected call; "end" offers to stop once it went quiet. */
  kind: "start" | "end";
  /** Set while the capsule plays its exit; it unmounts afterwards. */
  leaving: MeetingPromptLeaving;
}

/**
 * Tracks main's "meeting detected" / "meeting ended" suggestion for the capsule that grows out
 * of the floating pill. Exactly one answer reaches main per prompt (Start or
 * Stop, or Dismiss), or nothing when main retracts the prompt itself (the call
 * ended or came back, or the recording was started or stopped another way).
 */
export function useMeetingDetectionPrompt(): {
  prompt: MeetingPromptDisplay | null;
  respond: (action: MeetingPromptAction) => void;
} {
  const [prompt, setPrompt] = useState<MeetingPromptDisplay | null>(null);
  const promptRef = useRef<MeetingPromptDisplay | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: MeetingPromptDisplay | null) => {
    promptRef.current = next;
    setPrompt(next);
  }, []);

  const leave = useCallback(
    (leaving: Exclude<MeetingPromptLeaving, false>) => {
      const current = promptRef.current;
      if (!current || current.leaving) return;
      show({ ...current, leaving });
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null;
        if (promptRef.current?.promptId === current.promptId) show(null);
      }, MEETING_PROMPT_EXIT_MS);
    },
    [show]
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMeetingDetectionPrompt) return undefined;
    const unsubscribePrompt = api.onMeetingDetectionPrompt(({ promptId, appName, kind }) => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = null;
      show({ promptId, appName, kind: kind === "end" ? "end" : "start", leaving: false });
    });
    const unsubscribeCleared = api.onMeetingDetectionPromptCleared?.(({ promptId }) => {
      if (promptRef.current?.promptId === promptId) leave("cleared");
    });
    return () => {
      unsubscribePrompt?.();
      unsubscribeCleared?.();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [leave, show]);

  const respond = useCallback(
    (action: MeetingPromptAction) => {
      const current = promptRef.current;
      if (!current || current.leaving) return;
      leave(action);
      void window.electronAPI?.respondMeetingDetection?.(current.promptId, action).catch(() => {});
    },
    [leave]
  );

  return { prompt, respond };
}
