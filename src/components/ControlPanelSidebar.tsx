import React, { useState } from "react";
import {
  Gift,
  Lock,
  Settings,
  ShieldCheck,
  HelpCircle,
  UserCircle,
  UserPlus,
  X,
  Zap,
} from "./icons";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import SupportDropdown from "./ui/SupportDropdown";
import { Button } from "./ui/button";
import type { UpsellDecision } from "../lib/upsell";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import { APP_NAME, SLIM_SKIP_CLOUD_AUTH } from "../config/slimFork";
import { BrandMarkIcon } from "./dictation/BrandMarkIcon";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";

export type { ControlPanelView };

const rowIconClass =
  "shrink-0 text-foreground/55 group-hover:text-foreground/90 dark:text-foreground/65 dark:group-hover:text-foreground/85 transition-colors duration-150";
const rowLabelClass =
  "text-[13px] text-foreground/90 group-hover:text-foreground dark:text-foreground/85 dark:group-hover:text-foreground transition-colors duration-150";
const rowButtonClass =
  "group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-start outline-none hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-ring/40 transition-colors duration-100";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenReferrals?: () => void;
  onInviteTeam?: () => void;
  onUpgrade?: () => void;
  isOverLimit?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  upsell: UpsellDecision;
  updateAction?: React.ReactNode;
  /** Dictation hotkey(s), shown as key caps in the footer card. */
  hotkey?: string;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenReferrals,
  onInviteTeam,
  onUpgrade,
  isOverLimit,
  userName,
  userEmail,
  userImage,
  isSignedIn,
  authLoaded,
  upsell,
  updateAction,
  hotkey,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const [upgradeDismissed, setUpgradeDismissed] = useState(
    () => localStorage.getItem("upgradeProDismissed") === "true"
  );
  // A blocked or expired avatar URL falls back to the icon instead of the
  // broken-image glyph, like AccountAvatar and MemberAvatar.
  const [failedImage, setFailedImage] = useState<string | null>(null);

  const showLimitBanner =
    !SLIM_SKIP_CLOUD_AUTH && upsell === "show" && Boolean(isSignedIn) && Boolean(isOverLimit);
  const showUpgradeBanner =
    !SLIM_SKIP_CLOUD_AUTH && upsell === "show" && !showLimitBanner && !upgradeDismissed;

  const navItems = useControlPanelNavItems();

  return (
    <div className="w-48 h-full shrink-0 flex flex-col bg-surface-window">
      <div
        className="flex items-center gap-2 px-3.5 h-12 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <BrandMarkIcon size={15} className="shrink-0 text-foreground" />
        <span className="text-[13px] font-semibold text-foreground truncate">{APP_NAME}</span>
      </div>

      <nav className="flex flex-col gap-px px-2 pt-1 pb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "group relative flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md outline-none transition-colors duration-100 text-start",
                "focus-visible:ring-1 focus-visible:ring-ring/40",
                isActive
                  ? "bg-foreground/[0.07] dark:bg-white/[0.08]"
                  : "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"
              )}
            >
              <Icon
                size={15}
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  isActive
                    ? "text-foreground"
                    : "text-foreground/55 group-hover:text-foreground/90 dark:text-foreground/65 dark:group-hover:text-foreground/85"
                )}
              />
              <span
                className={cn(
                  "text-[13px] transition-colors duration-150",
                  isActive
                    ? "text-foreground font-medium"
                    : "text-foreground/90 group-hover:text-foreground dark:text-foreground/85 dark:group-hover:text-foreground"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {hotkey && (
        <p className="flex flex-wrap items-center gap-1.5 px-4.5 pb-2 text-[12px] text-muted-foreground">
          {parseHotkeyList(hotkey).map((hk) => (
            <kbd
              key={hk}
              className="rounded border border-border bg-background px-1.5 font-sans text-[11px] font-medium leading-[18px] text-foreground/80"
            >
              {formatHotkeyLabel(hk)}
            </kbd>
          ))}
          <span>to dictate</span>
        </p>
      )}

      {showLimitBanner && (
        <div className="px-2 pb-2">
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 dark:bg-destructive/10 p-3">
            <div className="flex flex-col items-center text-center">
              <BrandMarkIcon size={28} className="mb-2 text-primary" />
              <p className="text-xs font-medium text-foreground mb-0.5">
                {t("sidebar.limitReached")}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground mb-2.5">
                {t("sidebar.limitReachedDescription")}
              </p>
              <Button size="sm" onClick={onUpgrade} className="h-7 w-full text-xs">
                {t("sidebar.viewPlans")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showUpgradeBanner && (
        <div className="px-2 pb-2">
          <div className="relative rounded-xl border border-[#6c50e9]/25 dark:border-[#6c50e9]/40 bg-card bg-gradient-to-b from-[#6c50e9]/15 via-[#6c50e9]/5 to-transparent dark:from-[#6c50e9]/30 dark:via-[#6c50e9]/10 p-3">
            <button
              onClick={() => {
                setUpgradeDismissed(true);
                localStorage.setItem("upgradeProDismissed", "true");
              }}
              aria-label={t("common.dismiss")}
              className="absolute top-2 end-2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <X size={12} />
            </button>
            <BrandMarkIcon size={28} className="mb-2.5 text-primary" />
            <p className="text-[13px] font-semibold text-foreground mb-0.5">
              {t("sidebar.upgradeTitle")}
            </p>
            <p className="text-xs leading-snug text-muted-foreground mb-2.5">
              {t("sidebar.upgradeDescription")}
            </p>
            <div className="space-y-1.5 mb-3">
              {(
                [
                  [Zap, t("sidebar.upgradeInstantSetup")],
                  [Lock, t("sidebar.upgradeZeroRetention")],
                  [ShieldCheck, t("sidebar.upgradeEnterpriseSecurity")],
                ] as const
              ).map(([Icon, label]) => (
                <div key={label} className="flex items-start gap-1.5">
                  <Icon size={12} className="shrink-0 mt-px text-foreground/60" />
                  <span className="text-[11px] leading-snug text-foreground/80">{label}</span>
                </div>
              ))}
            </div>
            <Button size="sm" onClick={onUpgrade} className="h-7 w-full text-xs">
              {t("sidebar.learnMore")}
            </Button>
          </div>
        </div>
      )}

      <div className="px-2 pb-2 space-y-0.5">
        {updateAction && (
          <div className="px-1 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}

        {!SLIM_SKIP_CLOUD_AUTH && onInviteTeam && (
          <button
            onClick={onInviteTeam}
            aria-label={t("sidebar.inviteTeam")}
            className={rowButtonClass}
          >
            <UserPlus size={16} className={rowIconClass} />
            <span className={rowLabelClass}>{t("sidebar.inviteTeam")}</span>
          </button>
        )}

        {!SLIM_SKIP_CLOUD_AUTH && isSignedIn && onOpenReferrals && (
          <button
            onClick={onOpenReferrals}
            aria-label={t("sidebar.referral")}
            className={rowButtonClass}
          >
            <Gift size={16} className={rowIconClass} />
            <span className={rowLabelClass}>{t("sidebar.referral")}</span>
          </button>
        )}

        <button
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className={rowButtonClass}
        >
          <Settings size={16} className={rowIconClass} />
          <span className={rowLabelClass}>{t("sidebar.settings")}</span>
        </button>

        {!SLIM_SKIP_CLOUD_AUTH && (
          <SupportDropdown
            trigger={
              <button aria-label={t("sidebar.support")} className={rowButtonClass}>
                <HelpCircle size={16} className={rowIconClass} />
                <span className={rowLabelClass}>{t("sidebar.support")}</span>
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
