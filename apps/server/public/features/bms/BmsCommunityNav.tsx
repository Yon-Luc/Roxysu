import { Link, useRouterState } from "@tanstack/react-router";
import { useAppDict } from "../../lib/i18n";

function tabClass(active: boolean): string {
  return `-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-[color,border-color] duration-150 ${
    active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
  }`;
}

export function BmsCommunityNav() {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const path = useRouterState({ select: (state) => state.location.pathname });
  const onBms = path === "/bms" || path.startsWith("/bms/players") || path.startsWith("/bms/charts");
  const onFeed = path === "/bms/feed" || path.startsWith("/bms/feed/");
  const onStats = path === "/bms/statistics";
  const onCompare = path === "/bms/compare" || path.startsWith("/bms/compare/");
  return (
    <nav className="flex gap-6 border-b border-line" aria-label={copy?.title ?? "BMS"}>
      <Link
        to="/bms"
        activeOptions={{ exact: true }}
        className={tabClass(onBms)}
        aria-current={onBms ? "page" : undefined}
      >
        {copy?.title ?? "BMS"}
      </Link>
      <Link
        to="/bms/feed"
        search={{}}
        className={tabClass(onFeed)}
        aria-current={onFeed ? "page" : undefined}
      >
        {copy?.feed ?? "Feed"}
      </Link>
      <Link
        to="/bms/statistics"
        className={tabClass(onStats)}
        aria-current={onStats ? "page" : undefined}
      >
        {copy?.statistics ?? "Statistics"}
      </Link>
      <Link
        to="/bms/compare"
        search={{}}
        className={tabClass(onCompare)}
        aria-current={onCompare ? "page" : undefined}
      >
        {copy?.compare ?? "Compare"}
      </Link>
    </nav>
  );
}
