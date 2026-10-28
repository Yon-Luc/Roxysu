import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import { fetchCollections } from "../../lib/api";
import {
  compareManiaParity,
  fetchManiaParityStatus,
  type ParityReport,
  type SkillKey,
} from "../../lib/devParity";
import { useHubJwt } from "../../lib/hub";
import { useAppDict, t } from "../../lib/i18n";

const QUERY_KEY = "roxysu:mania-parity-query";
const SKILLS: SkillKey[] = [
  "starRating",
  "starRatingSs",
  "speed",
  "technical",
  "jack",
  "coordination",
  "release",
  "variety",
];

function readStoredQuery(): string {
  try {
    return localStorage.getItem(QUERY_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatRel(rel: number): string {
  const pct = rel * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatStar(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(3);
}

export function ManiaParityPage() {
  const { dict } = useAppDict();
  const copy = dict?.maniaParity;
  const jwt = useHubJwt();
  const statusQuery = useQuery({
    queryKey: ["mania-parity", "status", jwt],
    queryFn: () => fetchManiaParityStatus(jwt),
  });
  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
    enabled: statusQuery.data?.enabled === true,
    staleTime: 60_000,
  });

  const [queryDraft, setQueryDraft] = useState(readStoredQuery);
  const [limit, setLimit] = useState<number | null>(null);
  const [mismatchesOnly, setMismatchesOnly] = useState(false);
  const [report, setReport] = useState<ParityReport | null>(null);

  const effectiveLimit = limit ?? statusQuery.data?.limitDefault ?? 16;
  const compare = useMutation({
    mutationFn: (query: string) =>
      compareManiaParity({ query, limit: effectiveLimit }, jwt),
    onSuccess: setReport,
  });

  const smartCollections = useMemo(
    () =>
      (collectionsQuery.data?.items ?? []).filter(
        (item): item is Extract<typeof item, { kind: "smart" }> =>
          item.kind === "smart" && item.query.trim().length > 0,
      ),
    [collectionsQuery.data],
  );

  const rows = useMemo(() => {
    const items = report?.items ?? [];
    return mismatchesOnly ? items.filter((row) => row.outside) : items;
  }, [mismatchesOnly, report]);

  function run(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setQueryDraft(trimmed);
    try {
      localStorage.setItem(QUERY_KEY, trimmed);
    } catch {
      // ignore quota
    }
    compare.mutate(trimmed);
  }

  if (statusQuery.isPending) {
    return <p className="text-sm text-muted">{copy?.loading ?? "Loading…"}</p>;
  }

  if (!statusQuery.data?.enabled) {
    return (
      <div className="space-y-3">
        <PageTitle>{copy?.title ?? "C# / TS parity"}</PageTitle>
        <p className="rx-subtitle max-w-2xl">
          {copy?.locked ??
            "This page is only available in a dev checkout, or when the library player or Hub session is Noy."}
        </p>
      </div>
    );
  }

  const status = statusQuery.data;
  const worst = report?.worst;

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>{copy?.title ?? "C# / TS parity"}</PageTitle>
        <p className="rx-subtitle max-w-3xl">
          {copy?.subtitle ??
            "Compare the mania difficulty port with the pinned C# reference on a query or a collection. Nomod only."}
        </p>
      </div>

      <section className="rx-panel space-y-4 p-5">
        <p className="text-sm text-muted">
          {status.sha
            ? t(copy?.sha ?? "Pinned SHA {{sha}}", { sha: status.sha.slice(0, 12) })
            : (copy?.shaMissing ?? "Pinned SHA not found")}
          {" · "}
          {status.csharpReady
            ? (copy?.runnerReady ?? "C# runner ready")
            : (copy?.runnerMissing ?? "C# runner is not built")}
        </p>
        {!status.csharpReady && status.hint ? (
          <p className="font-mono text-xs text-faint">{status.hint}</p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              {copy?.query ?? "Query"}
            </span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") run(queryDraft);
                }}
                placeholder='mode:mania key=7 title:"7K LN Dan Tech Practice"'
                className="rx-input min-w-0 flex-1 font-mono"
                spellCheck={false}
              />
              <QueryLanguageHelpButton />
            </div>
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              {copy?.limit ?? "Limit"}
            </span>
            <input
              type="number"
              min={1}
              max={status.limitMax}
              value={effectiveLimit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rx-input mt-1.5 w-24 font-mono"
            />
          </label>
          <button
            type="button"
            className="rx-btn-primary"
            disabled={!status.csharpReady || compare.isPending || !queryDraft.trim()}
            onClick={() => run(queryDraft)}
          >
            {compare.isPending
              ? (copy?.comparing ?? "Comparing…")
              : (copy?.compare ?? "Compare")}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {status.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="rounded-lg bg-elevated/60 px-2.5 py-1 font-mono text-xs text-muted hover:bg-elevated hover:text-ink"
              onClick={() => {
                setQueryDraft(preset.query);
                if (status.csharpReady && !compare.isPending) run(preset.query);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {smartCollections.length > 0 ? (
          <label className="block max-w-md">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              {copy?.collection ?? "Collection"}
            </span>
            <select
              className="rx-input mt-1.5 w-full"
              defaultValue=""
              onChange={(e) => {
                const query = smartCollections.find(
                  (item) => String(item.id) === e.target.value,
                )?.query;
                if (query) run(query);
              }}
            >
              <option value="">{copy?.collectionPlaceholder ?? "Run a collection query"}</option>
              {smartCollections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {compare.error ? (
          <p className="text-sm text-danger">{compare.error.message}</p>
        ) : null}
      </section>

      {report ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-ink">
                {t(copy?.compared ?? "{{compared}} of {{total}} maps", {
                  compared: report.compared,
                  total: report.total,
                })}
                {report.skipped > 0
                  ? t(copy?.skipped ?? ", {{n}} skipped", { n: report.skipped })
                  : ""}
                {" · "}
                {report.outside === 0
                  ? (copy?.allInside ?? "all inside tolerance")
                  : t(copy?.outside ?? "{{n}} outside tolerance", {
                      n: report.outside,
                    })}
              </p>
              <p className="mt-1 text-xs text-faint">
                {copy?.tolerance ??
                  "A skill matches when the gap is within 2% or 0.05 stars. Deltas are TS minus C#."}
              </p>
              {worst ? (
                <p className="mt-1 text-xs text-danger">
                  {t(copy?.worst ?? "Widest gap: {{metric}} {{rel}}", {
                    metric: worst.metric,
                    rel: formatRel(worst.rel),
                  })}
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={mismatchesOnly}
                onChange={(e) => setMismatchesOnly(e.target.checked)}
              />
              {copy?.mismatches ?? "Mismatches only"}
            </label>
          </div>

          <div className="rx-panel overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-3 py-2 font-semibold">{copy?.map ?? "Map"}</th>
                  <th className="px-3 py-2 font-semibold">LN</th>
                  <th className="px-3 py-2 text-right font-semibold">C#</th>
                  <th className="px-3 py-2 text-right font-semibold">TS</th>
                  {SKILLS.map((key) => (
                    <th key={key} className="px-3 py-2 text-right font-semibold">
                      {copy?.skills?.[key] ?? key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-muted" colSpan={4 + SKILLS.length}>
                      {copy?.empty ?? "Nothing to show."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="max-w-[18rem] px-3 py-2">
                        <Link
                          to="/practice/$beatmapId"
                          params={{ beatmapId: row.id }}
                          className="font-medium text-ink hover:underline"
                        >
                          {row.difficultyName ?? row.title ?? row.id}
                        </Link>
                        <p className="truncate text-xs text-faint">
                          {row.title}
                          {row.keyCount != null ? ` · ${row.keyCount}K` : ""}
                        </p>
                        {row.error ? (
                          <p className="mt-1 text-xs text-danger">{row.error}</p>
                        ) : null}
                        {!row.countsMatch && !row.error ? (
                          <p className="mt-1 text-xs text-danger">
                            {copy?.countMismatch ?? "Note or hold count differs"}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">
                        {row.csharp?.lnRatio != null
                          ? `${Math.round(row.csharp.lnRatio * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatStar(row.csharp?.starRating)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatStar(row.ts?.starRating)}
                      </td>
                      {SKILLS.map((key) => {
                        const delta = row.deltas[key];
                        if (!delta) {
                          return (
                            <td key={key} className="px-3 py-2 text-right text-faint">
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={key}
                            className={`px-3 py-2 text-right tabular-nums ${
                              delta.ok ? "text-muted" : "text-danger"
                            }`}
                            title={`TS ${formatStar(row.ts?.[key])} · C# ${formatStar(row.csharp?.[key])}`}
                          >
                            {formatRel(delta.rel)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
