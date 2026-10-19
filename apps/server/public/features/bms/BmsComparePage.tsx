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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <BmsCommunityNav />
      <PageTitle>{copy?.compare ?? "Compare"}</PageTitle>
      <form
        className="flex flex-wrap items-end gap-3"
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
        <label className="text-sm text-muted">
          {copy?.player ?? "Player"}
          <input className="rx-input ml-2" value={left} onChange={(event) => setLeft(event.target.value)} />
        </label>
        <label className="text-sm text-muted">
          {copy?.player ?? "Player"}
          <input className="rx-input ml-2" value={right} onChange={(event) => setRight(event.target.value)} />
        </label>
        <label className="text-sm text-muted">
          {copy?.variant ?? "Variant"}
          <input className="rx-input ml-2" value={variant} onChange={(event) => setVariant(event.target.value)} />
        </label>
        <label className="text-sm text-muted">
          {copy?.tables ?? "Tables"}
          <select className="rx-select ml-2" name="tableId" defaultValue={search.tableId ?? ""}>
            <option value="">{copy?.none ?? "None"}</option>
            {(catalogue.data?.tables ?? []).map((table) => (
              <option key={table.id} value={table.id}>
                {table.symbol ? `${table.symbol} · ` : ""}
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          {copy?.achievement ?? "Achievement"}
          <select className="rx-select ml-2" name="achievement" defaultValue={search.achievement ?? "aa"}>
            {BMS_ACHIEVEMENTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rx-btn-primary">
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
                  <ul className="mt-3 space-y-1 text-sm">
                    {player.table.levels.map((level) => (
                      <li key={level.level} className="flex justify-between">
                        <span>{level.level}</span>
                        <span className="tabular-nums">
                          {level.cleared} / {level.total}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
          <section className="rx-panel p-4">
            <h2 className="font-display text-lg font-semibold">{copy?.scores ?? "Scores"}</h2>
            {compared.data.charts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {compared.data.charts.map((chart) => (
                  <li key={chart.chartMd5} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {chart.title ?? chart.chartMd5}
                      <span className="ml-2 text-muted">{chart.artist ?? ""}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
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
