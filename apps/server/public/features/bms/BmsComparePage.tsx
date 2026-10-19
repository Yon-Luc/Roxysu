import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { useHubJwt, useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";
import { fetchBmsCompare, fetchPublicBmsCatalogue } from "./api";
import { BmsCommunityNav } from "./BmsCommunityNav";
import { BMS_ACHIEVEMENTS } from "./types";

export type BmsCompareSearch = {
  variant?: string;
  tableId?: string;
  achievement?: string;
  playerA?: string;
};

export function BmsComparePage({
  playerA,
  playerB,
  search,
}: {
  playerA?: string;
  playerB?: string;
  search: BmsCompareSearch;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const hubUrl = useHubUrl();
  const token = useHubJwt();
  const navigate = useNavigate();
  const [left, setLeft] = useState(playerA ?? search.playerA ?? "");
  const [right, setRight] = useState(playerB ?? "");
  const [variant, setVariant] = useState(search.variant ?? "standard");
  useEffect(() => {
    if (playerA) setLeft(playerA);
    if (playerB) setRight(playerB);
    if (search.variant) setVariant(search.variant);
  }, [playerA, playerB, search.variant]);
  const catalogue = useQuery({
    queryKey: ["bms-public-catalogue", hubUrl],
    queryFn: () => fetchPublicBmsCatalogue(hubUrl),
  });
  const compared = useQuery({
    queryKey: ["bms-compare", hubUrl, playerA, playerB, search, token],
    queryFn: () =>
      fetchBmsCompare(
        hubUrl,
        playerA!,
        playerB!,
        {
          variant: search.variant || "standard",
          tableId: search.tableId,
          achievement: search.achievement,
        },
        token,
      ),
    enabled: !!playerA && !!playerB && playerA.toLowerCase() !== playerB.toLowerCase(),
  });

  function open(next: { playerA: string; playerB: string; variant: string; tableId?: string; achievement?: string }) {
    void navigate({
      to: "/bms/compare/$playerA/$playerB",
      params: { playerA: next.playerA.trim(), playerB: next.playerB.trim() },
      search: {
        variant: next.variant.trim() || "standard",
        ...(next.tableId ? { tableId: next.tableId } : {}),
        ...(next.achievement ? { achievement: next.achievement } : {}),
      },
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BmsCommunityNav />
      <PageTitle>{copy?.compare ?? "Compare"}</PageTitle>
      <form
        className="grid gap-3 rounded-lg bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          open({
            playerA: left,
            playerB: right,
            variant,
            tableId: String(data.get("tableId") ?? "") || undefined,
            achievement: String(data.get("achievement") ?? "") || undefined,
          });
        }}
      >
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
          {copy?.player ?? "Player"}
          <input className="rx-input" value={left} onChange={(event) => setLeft(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
          {copy?.player ?? "Player"}
          <input className="rx-input" value={right} onChange={(event) => setRight(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
          {copy?.variant ?? "Variant"}
          <input className="rx-input" value={variant} onChange={(event) => setVariant(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
          {copy?.tables ?? "Tables"}
          <select className="rx-select" name="tableId" defaultValue={search.tableId ?? ""}>
            <option value="">{copy?.none ?? "None"}</option>
            {(catalogue.data?.tables ?? []).map((table) => (
              <option key={table.id} value={table.id}>
                {table.symbol ? `${table.symbol} · ` : ""}
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
          {copy?.achievement ?? "Achievement"}
          <select className="rx-select" name="achievement" defaultValue={search.achievement ?? "aa"}>
            {BMS_ACHIEVEMENTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rx-btn-primary w-fit self-end">
          {copy?.compare ?? "Compare"}
        </button>
      </form>
      {compared.error instanceof Error ? (
        <p className="text-sm text-warning">
          {/not found|404/i.test(compared.error.message)
            ? (copy?.privateHidden ?? "This profile is private.")
            : compared.error.message}
        </p>
      ) : null}
      {compared.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {compared.data.players.map((player) => (
              <section key={player.username} className="rx-panel p-4">
                <h2 className="font-display text-lg font-semibold">{player.username}</h2>
                <p className="text-sm text-muted">{player.countryCode ?? ""}</p>
                <p className="mt-2 tabular-nums">
                  {player.plays} {copy?.plays ?? "Plays"} · EX {player.bestEx ?? "—"}
                </p>
                {player.table ? (
                  <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
                    {player.table.levels.map((level) => (
                      <div
                        key={level.level}
                        className="w-14 shrink-0 rounded-md bg-base px-1.5 py-1.5 text-center"
                      >
                        <div className="text-xs font-semibold">{level.level}</div>
                        <div className="text-[10px] tabular-nums text-muted">
                          {level.cleared}/{level.total}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          <section className="rx-panel p-4">
            <h2 className="font-display text-lg font-semibold">{copy?.scores ?? "Scores"}</h2>
            {compared.data.charts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
            ) : (
              <ul className="mt-3">
                {compared.data.charts.map((chart) => (
                  <li
                    key={chart.chartMd5}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {chart.title ?? chart.chartMd5}
                      {chart.artist ? <span className="text-muted"> · {chart.artist}</span> : null}
                    </span>
                    <span className="tabular-nums text-muted">
                      {chart.a?.exScore ?? "—"} · {chart.b?.exScore ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
