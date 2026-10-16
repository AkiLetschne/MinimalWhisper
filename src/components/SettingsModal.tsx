import React, { useMemo, useState } from "react";
import { Sliders, Mic, Wand2, Clock, Info, Keyboard } from "./icons";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";
import MinimalSettings, { type MinimalSettingsSection } from "./MinimalSettings";

export type SettingsSectionType = MinimalSettingsSection;

// Upstream deep-links (onboarding, banners, tray) still use OpenWhispr's section names.
const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  transcription: "speechToText",
  uploadTranscription: "speechToText",
  aiModels: "llms",
  intelligence: "llms",
  prompts: "llms",
  privacy: "privacyData",
  permissions: "general",
  softwareUpdates: "system",
  developer: "system",
};

const SECTIONS: readonly SettingsSectionType[] = [
  "general",
  "hotkeys",
  "speechToText",
  "llms",
  "privacyData",
  "system",
];

function resolveSection(section: string | undefined): SettingsSectionType {
  if (!section) return "general";
  const resolved = SECTION_ALIASES[section] ?? section;
  return (SECTIONS as readonly string[]).includes(resolved)
    ? (resolved as SettingsSectionType)
    : "general";
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
  const sidebarItems: SidebarItem<SettingsSectionType>[] = useMemo(
    () => [
      { id: "general", label: "General", icon: Sliders },
      { id: "hotkeys", label: "Hotkey", icon: Keyboard },
      { id: "speechToText", label: "Transcription", icon: Mic, group: "Models" },
      { id: "llms", label: "Cleanup", icon: Wand2, group: "Models" },
      { id: "privacyData", label: "History", icon: Clock, group: "Data" },
      { id: "system", label: "About", icon: Info, group: "Data" },
    ],
    []
  );

  const [activeSection, setActiveSection] = useState<SettingsSectionType>(() =>
    resolveSection(initialSection)
  );
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialSection) setActiveSection(resolveSection(initialSection));
  }

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      header={<p className="px-2 text-[13px] font-semibold text-foreground">Settings</p>}
    >
      <MinimalSettings section={activeSection} />
    </SidebarModal>
  );
}
