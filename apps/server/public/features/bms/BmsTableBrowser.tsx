import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { t, useAppDict } from "../../lib/i18n";
import type { BmsTableBlock, BmsTableLevel } from "./types";
import { BMS_ACHIEVEMENTS } from "./types";

const CANONICAL = [
  { symbol: "★", name: "発狂BMS難易度表" },
  { symbol: "sl", name: "Satellite" },
  { symbol: "st", name: "Stella" },
];
const PRESS =
  "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]";

function tableRank(table: BmsTableBlock): number {
  const known = CANONICAL.findIndex((item) => item.symbol === table.symbol && item.name === table.name);
  if (known !== -1) return known;
  return CANONICAL.length + 1;
}

function totals(table: BmsTableBlock) {
  return table.levels.reduce(
    (sum, level) => ({ cleared: sum.cleared + level.cleared, total: sum.total + level.total }),
    { cleared: 0, total: 0 },
  );
}

function frontier(levels: BmsTableLevel[]): BmsTableLevel | undefined {
  return (
    levels.find((level) => level.cleared > 0 && level.cleared < level.total) ??
    levels.find((level) => level.cleared > 0) ??
    levels[0]
  );
}

function percent(cleared: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((cleared / total) * 100));
}

export function BmsTableBrowser({
  tables,
  achievement,
  onAchievement,
}: {
  tables: BmsTableBlock[];
  achievement: string;
  onAchievement: (achievement: string) => void;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const ordered = useMemo(
    () =>
      [...tables].sort(
        (a, b) => tableRank(a) - tableRank(b) || a.name.localeCompare(b.name),
      ),
    [tables],
  );
  const [picked, setPicked] = useState<{ tableId: string; level: string } | null>(null);
  const [query, setQuery] = useState("");
  const table =
    ordered.find((item) => item.tableId === picked?.tableId) ??
    [...ordered].sort((a, b) => totals(b).cleared - totals(a).cleared)[0] ??
    ordered[0];
  const level =
    table?.levels.find((item) => item.level === picked?.level) ??
    (table ? frontier(table.levels) : undefined);
  const needle = query.trim().toLowerCase();
  const songs = useMemo(() => {
    const rows = level?.songs ?? [];
    if (!needle) return rows;
    return rows.filter((song) =>
      `${song.title ?? ""} ${song.artist ?? ""}`.toLowerCase().includes(needle),
    );
  }, [level, needle]);

  if (!table || !level) {
    return <p className="text-sm text-muted">{copy?.noTables ?? "No difficulty table is available."}</p>;
  }

  const tableTotals = totals(table);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {ordered.map((item) => {
            const sum = totals(item);
            const selected = item.tableId === table.tableId;
            return (
              <button
                key={item.tableId}
                type="button"
                aria-pressed={selected}
                className={`min-w-0 rounded-lg px-3 py-3 text-left ${PRESS} ${
                  selected ? "bg-elevated ring-1 ring-accent" : "bg-surface hover:bg-highlight"
                }`}
                onClick={() => {
                  const next = frontier(item.levels);
                  if (next) setPicked({ tableId: item.tableId, level: next.level });
                  setQuery("");
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-semibold leading-none">
                    {item.symbol || "—"}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted">
                    {t(copy?.cleared, { cleared: sum.cleared, total: sum.total })}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm text-ink">{item.name}</div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${percent(sum.cleared, sum.total)}%` }}
                  />
                </div>
              </button>
            );
          })}
      </div>

      <div className="bms-rail flex gap-1.5 overflow-x-auto pb-1">
        {table.levels.map((item) => {
          const selected = item.level === level.level;
          return (
            <button
              key={item.level}
              type="button"
              aria-pressed={selected}
              className={`flex w-[4.5rem] shrink-0 flex-col rounded-md px-2 py-2 text-left ${PRESS} ${
                selected ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink"
              }`}
              onClick={() => setPicked({ tableId: table.tableId, level: item.level })}
            >
              <span className="truncate font-display text-sm font-semibold leading-none">
                {table.symbol}
                {item.level}
              </span>
              <span className="mt-1 text-[10px] tabular-nums">
                {item.cleared}/{item.total}
              </span>
              <span className={`mt-2 h-0.5 overflow-hidden rounded-full ${selected ? "bg-white/30" : "bg-line"}`}>
                <span
                  className={`block h-full ${selected ? "bg-white" : "bg-accent"}`}
                  style={{ width: `${percent(item.cleared, item.total)}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <input
          className="rx-input w-full max-w-sm"
          value={query}
          placeholder={copy?.findChart ?? "Find a chart"}
          aria-label={copy?.findChart ?? "Find a chart"}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex items-end gap-3">
          <p className="pb-2 text-xs tabular-nums text-muted">
            {t(copy?.ofLevel, { shown: songs.length, total: level.songs?.length ?? level.total })}
          </p>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            {copy?.achievement ?? "Achievement"}
            <select
              className="rx-select"
              value={achievement}
              onChange={(event) => onAchievement(event.target.value)}
            >
              {BMS_ACHIEVEMENTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {table.unresolvedCount > 0 ? (
        <p className="text-xs text-muted">{t(copy?.unresolved, { count: table.unresolvedCount })}</p>
      ) : null}

      <div className="overflow-hidden rounded-lg bg-surface">
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-faint sm:grid-cols-[1.25rem_minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <span />
          <span>{copy?.titleCol ?? "Title"}</span>
          <span className="hidden sm:block">{copy?.artistCol ?? "Artist"}</span>
        </div>
        {songs.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted">{copy?.noMatches ?? "No charts match."}</p>
        ) : (
          <ul>
            {songs.map((song) => (
              <li
                key={`${song.md5 ?? ""}-${song.title ?? ""}`}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-highlight sm:grid-cols-[1.25rem_minmax(0,1.15fr)_minmax(0,0.85fr)]"
              >
                <span
                  className={`size-2 rounded-full ${
                    song.cleared ? "bg-accent" : "ring-1 ring-border"
                  }`}
                  aria-hidden
                />
                <div className="min-w-0">
                  {song.md5 ? (
                    <Link
                      to="/bms/charts/$chartId"
                      params={{ chartId: song.md5 }}
                      search={{}}
                      className={`block truncate hover:text-accent ${song.cleared ? "text-ink" : "text-muted"}`}
                    >
                      {song.title ?? song.md5}
                    </Link>
                  ) : (
                    <span className={`block truncate ${song.cleared ? "text-ink" : "text-muted"}`}>
                      {song.title ?? "—"}
                    </span>
                  )}
                  {song.artist ? (
                    <span className="block truncate text-xs text-faint sm:hidden">{song.artist}</span>
                  ) : null}
                </div>
                <span className="hidden truncate text-muted sm:block">{song.artist ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
