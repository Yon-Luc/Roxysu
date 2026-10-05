import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { fetchSettings, type SettingsPayload } from "../../lib/api";
import { useScrollToPageSection } from "../../lib/pageSections";
import { useAppDict, t } from "../../lib/i18n";
import { OsuDataFolderSection } from "./sections/OsuDataFolderSection";
import { OverlayHostSection } from "./sections/OverlayHostSection";
import { TosuLiveMapSection } from "./sections/TosuLiveMapSection";
import { MasteryFormulaSection } from "./sections/MasteryFormulaSection";
import { ScoreUsernameSection } from "./sections/ScoreUsernameSection";
import { GamemodeSection } from "./sections/GamemodeSection";
import { LiveSyncSection } from "./sections/LiveSyncSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { DifficultyDisplaySection } from "./sections/DifficultyDisplaySection";
import { PreviewSkinSection } from "./sections/PreviewSkinSection";
import { KeybindsSection } from "./sections/KeybindsSection";
import { ManiaRatingLabSection } from "./sections/ManiaRatingLabSection";
import { SunnyDanSection } from "./sections/SunnyDanSection";
import { DanielDanSection } from "./sections/DanielDanSection";
import { PatternAnalysisSection } from "./sections/PatternAnalysisSection";
import { AxisThresholdsSection } from "./sections/AxisThresholdsSection";
import {
  SETTINGS_TABS,
  resolveSettingsTab,
  type SettingsTabId,
} from "./settingsTabs";

const TAB_FALLBACK: Record<SettingsTabId, string> = {
  setup: "Setup",
  practice: "Practice",
  customize: "Customize",
  appearance: "Appearance",
  jobs: "Jobs",
};

function SettingsTabPanels({
  tab,
  data,
}: {
  tab: SettingsTabId;
  data: SettingsPayload;
}) {
  switch (tab) {
    case "setup":
      return (
        <>
          <OsuDataFolderSection data={data} />
          <LiveSyncSection data={data} />
          <OverlayHostSection data={data} />
          <TosuLiveMapSection data={data} />
        </>
      );
    case "practice":
      return (
        <>
          <MasteryFormulaSection data={data} />
          <ScoreUsernameSection data={data} />
          <GamemodeSection data={data} />
        </>
      );
    case "customize":
      return <AxisThresholdsSection data={data} />;
    case "appearance":
      return (
        <>
          <AppearanceSection />
          <DifficultyDisplaySection />
          <PreviewSkinSection />
          <KeybindsSection />
        </>
      );
    case "jobs":
      return (
        <>
          <SunnyDanSection data={data} />
          <DanielDanSection data={data} />
          <PatternAnalysisSection data={data} />
          <ManiaRatingLabSection data={data} />
        </>
      );
  }
}

export function SettingsPage({
  section,
  tab: tabSearch,
}: { section?: string; tab?: string } = {}) {
  const { dict } = useAppDict();
  const navigate = useNavigate();
  const activeTab = resolveSettingsTab(section, tabSearch);
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  useScrollToPageSection(section, { ready: !isLoading && !!data });

  const selectTab = (next: SettingsTabId) => {
    void navigate({
      to: "/settings",
      search: { tab: next, section: undefined },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeaderSkeleton subtitleWidth="w-[32rem]" />
        <div className="flex flex-wrap gap-2">
          <SkeletonBlock className="h-10 w-24 rounded-xl" />
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
          <SkeletonBlock className="h-10 w-32 rounded-xl" />
          <SkeletonBlock className="h-10 w-20 rounded-xl" />
        </div>
        <section className="rx-panel p-5">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="mt-2 h-4 w-full max-w-[36rem]" />
          <SkeletonBlock className="mt-1 h-4 w-full max-w-[30rem]" />
          <SkeletonBlock className="mt-5 h-3 w-24" />
          <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
          <div className="mt-4 flex gap-2">
            <SkeletonBlock className="h-10 w-28 rounded-xl" />
            <SkeletonBlock className="h-10 w-32 rounded-xl" />
          </div>
        </section>
        <PanelSkeleton lines={4} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-danger">
        {t(dict?.settings.failedToLoad, {
          error: error?.message ?? "unknown",
        })}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>{dict?.settings.pageTitle ?? "Settings"}</PageTitle>
        <p className="rx-subtitle">{dict?.settings.subtitle}</p>
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={dict?.settings.pageTitle ?? "Settings"}
      >
        {SETTINGS_TABS.map((tabDef) => {
          const selected = activeTab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "rx-btn-primary" : "rx-btn"}
              onClick={() => selectTab(tabDef.id)}
            >
              {dict?.settings.tabs?.[tabDef.labelKey] ??
                TAB_FALLBACK[tabDef.id]}
            </button>
          );
        })}
      </div>

      <div className="space-y-8" role="tabpanel">
        <SettingsTabPanels tab={activeTab} data={data} />
      </div>
    </div>
  );
}
