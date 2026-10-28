import { lazy } from "react";
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { PracticeListPage } from "./features/practice/PracticeListPage";
import { PracticeProfilePage } from "./features/practice/PracticeProfilePage";
import { SessionsPage } from "./features/sessions/SessionsPage";
import { SessionDetailPage } from "./features/sessions/SessionDetailPage";
import { CollectionsPage } from "./features/collections/CollectionsPage";
import { CollectionResultsPage } from "./features/collections/CollectionResultsPage";
import { HubCallbackPage } from "./features/hub/HubCallbackPage";
import { NowSelectedPage } from "./features/now-selected/NowSelectedPage";

const BmsLocalPage = lazy(() =>
  import("./features/bms/BmsLocalPage").then((m) => ({ default: m.BmsLocalPage })),
);
const BmsPlayerPage = lazy(() =>
  import("./features/bms/BmsPlayerPage").then((m) => ({ default: m.BmsPlayerPage })),
);
const BmsChartPage = lazy(() =>
  import("./features/bms/BmsChartPage").then((m) => ({ default: m.BmsChartPage })),
);
const BmsComparePage = lazy(() =>
  import("./features/bms/BmsComparePage").then((m) => ({ default: m.BmsComparePage })),
);
const BmsFeedPage = lazy(() =>
  import("./features/bms/BmsFeedPage").then((m) => ({ default: m.BmsFeedPage })),
);
const BmsStatsPage = lazy(() =>
  import("./features/bms/BmsStatsPage").then((m) => ({ default: m.BmsStatsPage })),
);
const OverlayEditorPage = lazy(() =>
  import("./features/overlay-editor/OverlayEditorPage").then((m) => ({
    default: m.OverlayEditorPage,
  })),
);
const HubBrowsePage = lazy(() =>
  import("./features/hub/HubBrowsePage").then((m) => ({
    default: m.HubBrowsePage,
  })),
);
const HubDetailPage = lazy(() =>
  import("./features/hub/HubDetailPage").then((m) => ({
    default: m.HubDetailPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const SkinPage = lazy(() =>
  import("./features/settings/SkinPage").then((m) => ({
    default: m.SkinPage,
  })),
);
const OverlayPage = lazy(() =>
  import("./features/overlay/OverlayPage").then((m) => ({
    default: m.OverlayPage,
  })),
);

const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((m) => ({
    default: m.DashboardPage,
  })),
);
const StatsPage = lazy(() =>
  import("./features/stats/StatsPage").then((m) => ({
    default: m.StatsPage,
  })),
);
const DownloadMapsPage = lazy(() =>
  import("./features/download/DownloadMapsPage").then((m) => ({
    default: m.DownloadMapsPage,
  })),
);
const MarathonPage = lazy(() =>
  import("./features/marathon/MarathonPage").then((m) => ({
    default: m.MarathonPage,
  })),
);
const RatingLabPage = lazy(() =>
  import("./features/rating-lab/RatingLabPage").then((m) => ({
    default: m.RatingLabPage,
  })),
);
const HubSharePage = lazy(() =>
  import("./features/hub/HubSharePage").then((m) => ({
    default: m.HubSharePage,
  })),
);
const HubAdminCachePage = lazy(() =>
  import("./features/hub/HubAdminCachePage").then((m) => ({
    default: m.HubAdminCachePage,
  })),
);
const HubAdminCalcBundlesPage = lazy(() =>
  import("./features/hub/HubAdminCalcBundlesPage").then((m) => ({
    default: m.HubAdminCalcBundlesPage,
  })),
);
import { isDesktopShell } from "./lib/desktop";
import type { StatsGranularity, StatsSkillAxis } from "./lib/api";
import {
  readSkillTopPlays,
  writeSkillTopPlays,
} from "./lib/skillTopPlays";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardPage,
});

const statsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/stats",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    granularity: StatsGranularity;
    skillTopPlays: number;
    skillAxis: StatsSkillAxis;
    keyCount: number;
  } => {
    const granularity: StatsGranularity =
      search.granularity === "week" ? "week" : "day";
    // Legacy `range` search param ignored — stats are always all-time.
    const rawTop = Number(search.skillTopPlays);
    const skillTopPlays =
      Number.isFinite(rawTop) && rawTop >= 1 && rawTop <= 500
        ? Math.round(rawTop)
        : readSkillTopPlays();
    const rawAxis = search.skillAxis;
    const skillAxis: StatsSkillAxis =
      rawAxis === "rc" || rawAxis === "ln" || rawAxis === "fln"
        ? rawAxis
        : "all";
    const rawKeys = Number(search.keyCount);
    const keyCount =
      Number.isFinite(rawKeys) && rawKeys >= 1 && rawKeys <= 18
        ? Math.round(rawKeys)
        : 7;
    return { granularity, skillTopPlays, skillAxis, keyCount };
  },
  component: function StatsRoute() {
    const navigate = statsRoute.useNavigate();
    const { granularity, skillTopPlays, skillAxis, keyCount } =
      statsRoute.useSearch();
    return (
      <StatsPage
        granularity={granularity}
        skillTopPlays={skillTopPlays}
        skillAxis={skillAxis}
        keyCount={keyCount}
        onGranularityChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, granularity: next }) })
        }
        onSkillTopPlaysChange={(next) => {
          writeSkillTopPlays(next);
          navigate({ search: (prev) => ({ ...prev, skillTopPlays: next }) });
        }}
        onSkillAxisChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, skillAxis: next }) })
        }
        onKeyCountChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, keyCount: next }) })
        }
      />
    );
  },
});

const practiceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/practice",
  component: PracticeListPage,
});

const practiceProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/practice/$beatmapId",
  component: function PracticeProfileRoute() {
    const { beatmapId } = practiceProfileRoute.useParams();
    return <PracticeProfilePage beatmapId={beatmapId} />;
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sessions/$sessionId",
  component: function SessionDetailRoute() {
    const { sessionId } = sessionDetailRoute.useParams();
    return <SessionDetailPage sessionId={sessionId} />;
  },
});

const nowSelectedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/now-selected",
  validateSearch: (
    search: Record<string, unknown>,
  ): { focus?: boolean } => ({
    focus:
      search.focus === true ||
      search.focus === "1" ||
      search.focus === "true"
        ? true
        : undefined,
  }),
  component: function NowSelectedRoute() {
    const { focus } = nowSelectedRoute.useSearch();
    return <NowSelectedPage focus={Boolean(focus)} />;
  },
});

const collectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/collections",
  component: CollectionsPage,
});

const collectionResultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/collections/$collectionId",
  component: function CollectionResultsRoute() {
    const { collectionId } = collectionResultsRoute.useParams();
    return <CollectionResultsPage collectionId={collectionId} />;
  },
});

const ratingLabRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/rating-lab",
  component: RatingLabPage,
});

const downloadMapsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/download-maps",
  component: DownloadMapsPage,
});

const marathonRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/marathon",
  validateSearch: (
    search: Record<string, unknown>,
  ): { ids?: string; key?: number } => {
    const ids =
      typeof search.ids === "string" && search.ids.trim().length > 0
        ? search.ids
        : undefined;
    const rawKey = Number(search.key);
    const key = rawKey === 4 || rawKey === 7 ? rawKey : undefined;
    return { ids, key };
  },
  component: MarathonPage,
});

const hubRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub",
  component: HubBrowsePage,
});

const hubCallbackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub-callback",
  component: HubCallbackPage,
});

const hubShareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub/share",
  component: HubSharePage,
});

const hubAdminCacheRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub/admin/cache",
  component: HubAdminCachePage,
});

const hubAdminCalcBundlesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub/admin/calc-bundles",
  component: HubAdminCalcBundlesPage,
});

const hubDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/hub/$id",
  component: function HubDetailRoute() {
    const { id } = hubDetailRoute.useParams();
    return <HubDetailPage id={id} />;
  },
});

const bmsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms",
  component: BmsLocalPage,
});

const bmsPlayerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/players/$username",
  component: function BmsPlayerRoute() {
    const { username } = bmsPlayerRoute.useParams();
    return <BmsPlayerPage username={username} view="overview" />;
  },
});

const bmsPlayerScoresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/players/$username/scores",
  component: function BmsPlayerScoresRoute() {
    const { username } = bmsPlayerScoresRoute.useParams();
    return <BmsPlayerPage username={username} view="scores" />;
  },
});

const bmsPlayerTablesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/players/$username/tables",
  component: function BmsPlayerTablesRoute() {
    const { username } = bmsPlayerTablesRoute.useParams();
    return <BmsPlayerPage username={username} view="tables" />;
  },
});

function readChartSearch(search: Record<string, unknown>): {
  variant?: string;
  achievement?: string;
  gauge?: string;
  country?: string;
  cursor?: string;
} {
  return {
    ...(typeof search.variant === "string" ? { variant: search.variant } : {}),
    ...(typeof search.achievement === "string" ? { achievement: search.achievement } : {}),
    ...(typeof search.gauge === "string" ? { gauge: search.gauge } : {}),
    ...(typeof search.country === "string" ? { country: search.country } : {}),
    ...(typeof search.cursor === "string" ? { cursor: search.cursor } : {}),
  };
}

const bmsChartRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/charts/$chartId",
  validateSearch: readChartSearch,
  component: function BmsChartRoute() {
    const { chartId } = bmsChartRoute.useParams();
    const search = bmsChartRoute.useSearch();
    const navigate = useNavigate();
    return (
      <BmsChartPage
        chartId={chartId}
        search={search}
        onSearch={(next) => {
          void navigate({ to: "/bms/charts/$chartId", params: { chartId }, search: next });
        }}
      />
    );
  },
});

const bmsChartBoardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/charts/$chartId/leaderboard",
  validateSearch: readChartSearch,
  component: function BmsChartBoardRoute() {
    const { chartId } = bmsChartBoardRoute.useParams();
    const search = bmsChartBoardRoute.useSearch();
    const navigate = useNavigate();
    return (
      <BmsChartPage
        chartId={chartId}
        search={search}
        onSearch={(next) => {
          void navigate({
            to: "/bms/charts/$chartId/leaderboard",
            params: { chartId },
            search: next,
          });
        }}
      />
    );
  },
});

function readCompareSearch(search: Record<string, unknown>): {
  variant?: string;
  tableId?: string;
  achievement?: string;
  playerA?: string;
} {
  return {
    ...(typeof search.variant === "string" ? { variant: search.variant } : {}),
    ...(typeof search.tableId === "string" ? { tableId: search.tableId } : {}),
    ...(typeof search.achievement === "string" ? { achievement: search.achievement } : {}),
    ...(typeof search.playerA === "string" ? { playerA: search.playerA } : {}),
  };
}

const bmsCompareFormRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/compare",
  validateSearch: readCompareSearch,
  component: function BmsCompareFormRoute() {
    const search = bmsCompareFormRoute.useSearch();
    return <BmsComparePage search={search} />;
  },
});

const bmsCompareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/compare/$playerA/$playerB",
  validateSearch: readCompareSearch,
  component: function BmsCompareRoute() {
    const { playerA, playerB } = bmsCompareRoute.useParams();
    const search = bmsCompareRoute.useSearch();
    return <BmsComparePage playerA={playerA} playerB={playerB} search={search} />;
  },
});

const bmsFeedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/feed",
  validateSearch: (search: Record<string, unknown>): { cursor?: string } =>
    typeof search.cursor === "string" ? { cursor: search.cursor } : {},
  component: function BmsFeedRoute() {
    const { cursor } = bmsFeedRoute.useSearch();
    const navigate = useNavigate();
    return (
      <BmsFeedPage
        cursor={cursor}
        onCursor={(next) => {
          void navigate({
            to: "/bms/feed",
            search: next ? { cursor: next } : {},
          });
        }}
      />
    );
  },
});

const bmsStatsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/bms/statistics",
  component: BmsStatsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string; tab?: string } => ({
    section: typeof search.section === "string" ? search.section : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: function SettingsRoute() {
    const { section, tab } = settingsRoute.useSearch();
    return <SettingsPage section={section} tab={tab} />;
  },
});

const skinRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/skin",
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string } => ({
    section: typeof search.section === "string" ? search.section : undefined,
  }),
  component: function SkinRoute() {
    const { section } = skinRoute.useSearch();
    return <SkinPage section={section} />;
  },
});

const overlayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overlay",
  validateSearch: (
    search: Record<string, unknown>,
  ): { limit?: number; bg?: "solid" | "clear"; profile?: string } => ({
    limit:
      search.limit == null || search.limit === ""
        ? undefined
        : Number(search.limit),
    // Default is a solid panel; `clear` keeps only text + light row tint.
    bg:
      search.bg === "clear" || search.bg === "solid" ? search.bg : undefined,
    profile:
      typeof search.profile === "string" && search.profile.length > 0
        ? search.profile
        : undefined,
  }),
  component: function OverlayRoute() {
    const { limit, bg, profile } = overlayRoute.useSearch();
    return <OverlayPage limit={limit} bg={bg} profile={profile} />;
  },
});

const overlayEditorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/overlay-editor",
  component: function OverlayEditorRoute() {
    return <OverlayEditorPage />;
  },
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    indexRoute,
    statsRoute,
    practiceRoute,
    practiceProfileRoute,
    sessionsRoute,
    sessionDetailRoute,
    nowSelectedRoute,
    collectionsRoute,
    collectionResultsRoute,
    downloadMapsRoute,
    marathonRoute,
    hubRoute,
    hubCallbackRoute,
    hubShareRoute,
    hubAdminCacheRoute,
    hubAdminCalcBundlesRoute,
    hubDetailRoute,
    ...(isDesktopShell() ? [] : [ratingLabRoute]),
    skinRoute,
    settingsRoute,
    bmsRoute,
    bmsPlayerRoute,
    bmsPlayerScoresRoute,
    bmsPlayerTablesRoute,
    bmsChartRoute,
    bmsChartBoardRoute,
    bmsCompareFormRoute,
    bmsCompareRoute,
    bmsFeedRoute,
    bmsStatsRoute,
  ]),
  overlayRoute,
  overlayEditorRoute,
]);

export const router = createRouter({
  routeTree,
  // Hash history avoids needing server SPA fallback under Bun static/fullstack.
  history: createHashHistory(),
  // Remember window scroll per path + search so sidebar and back both return
  // to the same place. A new search still starts at the top.
  scrollRestoration: true,
  scrollRestorationBehavior: "instant",
  getScrollRestorationKey: (location) =>
    location.pathname + location.searchStr,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
