import { forwardRef, useEffect, useState, type MouseEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { X } from "../icons";
import { BrandMarkIcon } from "./BrandMarkIcon";
import type {
  MeetingPromptAction,
  MeetingPromptDisplay,
} from "../../hooks/useMeetingDetectionPrompt";

interface MeetingPromptCapsuleProps {
  prompt: MeetingPromptDisplay;
  align: "left" | "right" | "center";
  onRespond: (action: MeetingPromptAction) => void;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
}

// "Microsoft Teams" reads as just "Teams" in a one-line prompt.
const shortAppName = (name: string) => name.replace(/^Microsoft\s+/i, "");

/**
 * Meeting suggestions that widen out of the floating pill the way it widens
 * when dictation starts. "start" covers the idle pill exactly and turns the
 * logo's spot into a record button; "end" grows out of the red meeting pill
 * and offers a stop button there instead. The choreography lives in
 * dictation-panel.css (.meeting-prompt).
 */
export const MeetingPromptCapsule = forwardRef<HTMLDivElement, MeetingPromptCapsuleProps>(
  function MeetingPromptCapsule({ prompt, align, onRespond, onMouseEnter, onMouseLeave }, ref) {
    const { t } = useTranslation();
    const leaving = Boolean(prompt.leaving);
    // Mount collapsed (identical to the pill), then open on the next frame so
    // the width transition has a starting point.
    const [opened, setOpened] = useState(false);
    useEffect(() => {
      const frame = requestAnimationFrame(() => setOpened(true));
      return () => cancelAnimationFrame(frame);
    }, []);
    const phase = leaving ? "closing" : opened ? "open" : "collapsed";
    const ending = prompt.kind === "end";
    const app = shortAppName(prompt.appName);

    const label = (
      <span className="meeting-prompt-label">
        {ending
          ? t("meetings.detection.endTitle", { app })
          : t("meetings.detection.pillTitle", { app })}
      </span>
    );
    const dismiss = (
      <button
        type="button"
        className="meeting-prompt-dismiss"
        aria-label={
          ending ? t("meetings.detection.keepRecording") : t("meetings.detection.dismiss")
        }
        disabled={leaving}
        onClick={() => onRespond("dismiss")}
      >
        <X className="size-3.5" strokeWidth={2.25} />
      </button>
    );
    const record = (
      <span className="meeting-prompt-slot">
        <span className="meeting-prompt-logo" aria-hidden="true">
          <BrandMarkIcon size={22} />
        </span>
        <button
          type="button"
          className="meeting-prompt-record"
          aria-label={ending ? t("meetings.detection.stop") : t("meetings.detection.pillStart")}
          disabled={leaving}
          onClick={() => onRespond(ending ? "stop" : "start")}
        >
          <span className="meeting-prompt-record-core" />
        </button>
      </span>
    );

    return (
      <div
        ref={ref}
        className="meeting-prompt"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-align={align}
        data-kind={prompt.kind}
        data-phase={phase}
        data-leaving={prompt.leaving || undefined}
        role="alertdialog"
        aria-label={
          ending
            ? t("meetings.detection.endTitle", { app })
            : t("meetings.detection.title", { app: prompt.appName })
        }
        aria-hidden={leaving || undefined}
      >
        <div className="meeting-prompt-row">
          {/* The record button always takes the logo's place at the pill's
            outer edge, so the order mirrors on a left dock. */}
          {align === "left" ? (
            <>
              {record}
              {dismiss}
              {label}
            </>
          ) : (
            <>
              {label}
              {dismiss}
              {record}
            </>
          )}
        </div>
      </div>
    );
  }
);
