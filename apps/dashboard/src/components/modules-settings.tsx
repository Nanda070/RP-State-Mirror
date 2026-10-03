"use client";

import { useState, type ComponentProps } from "react";
import { MODULE_TABS, type ModuleTab } from "@/lib/module-tabs";
import { TabIcon } from "./page-tabs";
import { SettingsDocumentsForm, SettingsWantedForm } from "./settings-module-form";
import { Stage4SettingsManager, type ModuleTabId } from "./stage4-settings-manager";

const TABS = MODULE_TABS;
type TabId = ModuleTab;

/**
 * Settings of every module behind one strip of tabs. The tab is client state (and mirrored into the
 * address), so switching tabs does not lose what was typed in another one.
 */
export function ModulesSettings({
  initialTab,
  documents,
  wanted,
  manager,
}: {
  initialTab: ModuleTab;
  documents: ComponentProps<typeof SettingsDocumentsForm>;
  wanted: ComponentProps<typeof SettingsWantedForm>;
  manager: Omit<ComponentProps<typeof Stage4SettingsManager>, "tab">;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [managerTab, setManagerTab] = useState<ModuleTabId>(
    tab === "documents" || tab === "wanted" ? "registrations" : tab,
  );

  function open(next: TabId) {
    setTab(next);
    if (next !== "documents" && next !== "wanted") setManagerTab(next);
    window.history.replaceState(null, "", next === "documents" ? "/settings/modules" : `/settings/modules?tab=${next}`);
  }

  return (
    <>
      <div className="settings-tabs" role="tablist" aria-label="Модули">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="settings-tab"
            aria-selected={tab === entry.id}
            data-active={tab === entry.id ? "" : undefined}
            onClick={() => open(entry.id)}
          >
            <TabIcon name={entry.icon} />
            {entry.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "documents"}>
        <SettingsDocumentsForm {...documents} />
      </div>
      <div hidden={tab !== "wanted"}>
        <SettingsWantedForm {...wanted} />
      </div>
      <div hidden={tab === "documents" || tab === "wanted"}>
        <Stage4SettingsManager {...manager} tab={managerTab} />
      </div>
    </>
  );
}
