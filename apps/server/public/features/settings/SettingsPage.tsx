import { useQuery } from "@tanstack/react-query";
import {
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { fetchSettings } from "../../lib/api";
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

export function SettingsPage({ section }: { section?: string } = {}) {
  const { dict } = useAppDict();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  useScrollToPageSection(section, { ready: !isLoading && !!data });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeaderSkeleton subtitleWidth="w-[32rem]" />
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
        <section className="rx-panel p-5">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="mt-2 h-4 w-full max-w-[34rem]" />
          <div className="mt-4 space-y-4">
            <PanelSkeleton lines={2} className="p-4" />
            <div>
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
            </div>
            <div>
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
            </div>
          </div>
        </section>
        <PanelSkeleton lines={4} />
        <PanelSkeleton lines={4} />
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

      <OsuDataFolderSection data={data} />
      <OverlayHostSection data={data} />
      <TosuLiveMapSection data={data} />
      <MasteryFormulaSection data={data} />
      <ScoreUsernameSection data={data} />
      <GamemodeSection data={data} />
      <LiveSyncSection data={data} />
      <AppearanceSection />
      <DifficultyDisplaySection />
      <PreviewSkinSection />
      <KeybindsSection />
      <ManiaRatingLabSection data={data} />
      <SunnyDanSection data={data} />
      <DanielDanSection data={data} />
      <PatternAnalysisSection data={data} />
    </div>
  );
}
