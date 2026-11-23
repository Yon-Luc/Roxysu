import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ListSkeleton,
  PageHeaderSkeleton,
  PanelSkeleton,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { fetchSessions } from "../../lib/api";
import { formatRelativeTime } from "../../lib/format";
import { useAppDict, t } from "../../lib/i18n";
import { useLanguage } from "../../lib/language";
import {
  SessionActivityCalendar,
  sessionStartedLocalDay,
  useLocalClock,
} from "./SessionActivityCalendar";

const DEFAULT_VISIBLE = 7;
/** S-NEW-1: Show all refetches with an explicit capped limit (server max). */
const SHOW_ALL_LIMIT = 500;

export function SessionsPage() {
  const { dict } = useAppDict();
  const locale = useLanguage();
  const { tzOffset, todayKey } = useLocalClock();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [dayShowAll, setDayShowAll] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions", tzOffset, todayKey],
    queryFn: () => fetchSessions(undefined, tzOffset),
  });
  // The default query only pulls the server's list cap; Show all fetches a
  // larger capped page instead of assuming the initial payload was unbounded.
  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ["sessions", "all", tzOffset, todayKey],
    queryFn: () => fetchSessions(undefined, tzOffset, SHOW_ALL_LIMIT),
    enabled: showAll && selectedDay == null,
  });
  // UI-N1: the day list asks for the hard max (500) instead of the 100-row
  // index cap, and `hasMore` still tells the UI when even that is truncated.
  const dayQuery = useQuery({
    queryKey: ["sessions", "day", selectedDay, tzOffset],
    queryFn: () => fetchSessions(selectedDay!, tzOffset, SHOW_ALL_LIMIT),
    enabled: selectedDay != null,
  });
  const dayItems = dayQuery.data?.items ?? [];
  const dayHasMore = dayQuery.data?.hasMore ?? false;

  const visibleItems = useMemo(() => {
    if (!data) return [];
    if (selectedDay) {
      return dayShowAll ? dayItems : dayItems.slice(0, DEFAULT_VISIBLE);
    }
    if (showAll) return allData?.items ?? data.items;
    return data.items.slice(0, DEFAULT_VISIBLE);
  }, [data, allData, dayItems, dayShowAll, selectedDay, showAll]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeaderSkeleton />
        <PanelSkeleton lines={3} />
        <ListSkeleton count={6} showThumbnail={false} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-danger">
        {t(dict?.session.failedToLoad, {
          error: error?.message ?? "unknown",
        })}
      </p>
    );
  }

  const hasMoreWithoutFilter = !selectedDay && data.items.length > DEFAULT_VISIBLE;
  const listHeading = selectedDay
    ? t(dict?.session.sessionsOnDay, { day: selectedDay }) ||
      `Sessions on ${selectedDay}`
    : (dict?.session.recentSessions ?? "Recent sessions");

  const handleShowAll = () => {
    if (selectedDay) {
      setSelectedDay(null);
      setDayShowAll(false);
      setShowAll(false);
      return;
    }
    setShowAll(true);
  };

  const handleShowLess = () => {
    setShowAll(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>{dict?.session.pageTitle}</PageTitle>
        <p className="rx-subtitle">{dict?.session.subtitle}</p>
      </div>

      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: "current" }}
        className="rx-panel flex flex-wrap items-end justify-between gap-3 px-4 py-4 transition hover:bg-elevated sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
            {data.current ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative flex h-2 w-2 rounded-full bg-accent" />
              </span>
            ) : null}
            {data.current
              ? dict?.session.nowPlaying
              : dict?.session.readyWhenYouAre}
          </div>
          <div className="mt-1 truncate font-display text-2xl font-bold text-ink">
            {data.current ? data.current.name : dict?.session.startASession}
          </div>
          <div className="mt-1 text-sm text-muted">
            {data.current ? (
              <>
                {t(dict?.session.playsCount, {
                  count: data.current.scoreCount,
                })}
                {" · "}
                {t(dict?.session.started, {
                  time: formatRelativeTime(
                    data.current.startedAt,
                    dict?.common,
                  ),
                })}
                {data.current.rulesetShortName
                  ? ` · ${data.current.rulesetShortName}`
                  : ""}
              </>
            ) : (
              dict?.session.startHint
            )}
          </div>
        </div>
        <span className="rx-btn-primary shrink-0 text-sm">
          {data.current ? dict?.session.openLive : dict?.session.open}
        </span>
      </Link>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {listHeading}
          </h2>
          {selectedDay ? (
            <div className="flex items-center gap-3">
              {dayItems.length > DEFAULT_VISIBLE ? (
                <button
                  type="button"
                  onClick={() => setDayShowAll((v) => !v)}
                  className="text-sm font-bold text-muted transition hover:text-accent"
                >
                  {dayShowAll
                    ? (dict?.session.showLessSessions ?? "Show less")
                    : (dict?.session.showAllSessions ?? "Show all")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleShowAll}
                className="text-sm font-bold text-muted transition hover:text-accent"
              >
                {dict?.session.clearDayFilter ?? "All sessions"}
              </button>
            </div>
          ) : hasMoreWithoutFilter && !showAll ? (
            <button
              type="button"
              onClick={handleShowAll}
              className="text-sm font-bold text-muted transition hover:text-accent"
            >
              {dict?.session.showAllSessions ?? "Show all"}
            </button>
          ) : hasMoreWithoutFilter && showAll ? (
            <button
              type="button"
              onClick={handleShowLess}
              className="text-sm font-bold text-muted transition hover:text-accent"
            >
              {dict?.session.showLessSessions ?? "Show less"}
            </button>
          ) : null}
        </div>

        {selectedDay && dayQuery.isLoading ? (
          <p className="text-sm text-muted">
            {dict?.session.loadingDay ?? "Loading sessions…"}
          </p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted">{dict?.session.noSessionsYet}</p>
        ) : visibleItems.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.session.noSessionsOnDay ?? "No sessions on this day."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visibleItems.map((s) => {
              const isOpen = s.endedAt == null;
              return (
                <li key={s.id}>
                  <Link
                    to="/sessions/$sessionId"
                    params={{
                      sessionId: isOpen ? "current" : String(s.id),
                    }}
                    className="rx-row justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink" title={s.name}>
                        {isOpen ? dict?.session.currentSession : s.name}
                        {isOpen ? (
                          <span className="ml-2 text-xs font-bold text-accent">
                            {dict?.session.live}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted">
                        {isOpen ? `${s.name} · ` : ""}
                        {formatRelativeTime(s.startedAt, dict?.common)}
                        {s.endedAt
                          ? ` → ${formatRelativeTime(s.endedAt, dict?.common)}`
                          : ""}
                        {s.rulesetShortName ? ` · ${s.rulesetShortName}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums text-subtle">
                      {t(dict?.session.playsCount, { count: s.scoreCount })}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {selectedDay && dayShowAll && dayHasMore ? (
          <p className="mt-2 text-xs text-faint">
            {t(dict?.session.dayCapped, { count: dayItems.length }) ||
              `Showing the first ${dayItems.length} sessions.`}
          </p>
        ) : null}
        {!selectedDay && showAll && allData?.hasMore ? (
          <p className="mt-2 text-xs text-faint">
            {t(dict?.session.dayCapped, { count: allData.items.length }) ||
              `Showing the first ${allData.items.length} sessions.`}
          </p>
        ) : null}
      </section>

      <SessionActivityCalendar
        activity={data.activity ?? []}
        sessionDayStats={data.items.map((s) => ({
          day: sessionStartedLocalDay(s.startedAt, tzOffset),
          plays: s.scoreCount,
        }))}
        selectedDay={selectedDay}
        todayKey={todayKey}
        locale={locale}
        onSelectDay={(day) => {
          setSelectedDay(day);
          setDayShowAll(false);
          if (day) setShowAll(false);
        }}
        title={dict?.session.activityCalendar ?? "Activity"}
        dayStatsLabel={(day, plays, sessions) =>
          t(dict?.session.dayStats, { day, plays, sessions }) ||
          `${day}: ${plays} plays · ${sessions} sessions`
        }
        lessLabel={dict?.session.activityLess ?? "Less"}
        moreLabel={dict?.session.activityMore ?? "More"}
        hint={
          dict?.session.activityFilterHint ??
          "Click a day to filter the list above."
        }
      />
    </div>
  );
}
