import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { PracticeListPage } from "./features/practice/PracticeListPage";
import { PracticeProfilePage } from "./features/practice/PracticeProfilePage";
import { SessionsPage } from "./features/sessions/SessionsPage";
import { CollectionsPage } from "./features/collections/CollectionsPage";
import { CollectionResultsPage } from "./features/collections/CollectionResultsPage";
import { SettingsPage } from "./features/settings/SettingsPage";

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const practiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice",
  component: PracticeListPage,
});

const practiceProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/$beatmapId",
  component: function PracticeProfileRoute() {
    const { beatmapId } = practiceProfileRoute.useParams();
    return <PracticeProfilePage beatmapId={beatmapId} />;
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  component: CollectionsPage,
});

const collectionResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$collectionId",
  component: function CollectionResultsRoute() {
    const { collectionId } = collectionResultsRoute.useParams();
    return <CollectionResultsPage collectionId={collectionId} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  practiceRoute,
  practiceProfileRoute,
  sessionsRoute,
  collectionsRoute,
  collectionResultsRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  // Hash history avoids needing server SPA fallback under Bun static/fullstack.
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
