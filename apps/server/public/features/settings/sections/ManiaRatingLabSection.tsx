import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRatingLabJob,
  patchSettings,
  startRatingLabJob,
  stopRatingLabJob,
  type SettingsPayload,
} from "../../../lib/api";
import { isDesktopShell } from "../../../lib/desktop";
import { pageSectionDomId } from "../../../lib/pageSections";
import { statusLabel } from "../../../lib/settingsLabels";
import { useAppDict, t } from "../../../lib/i18n";

export function ManiaRatingLabSection({ data }: { data: SettingsPayload }) {
  const desktop = isDesktopShell();
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const [maniaExeDrafts, setManiaExeDrafts] = useState<Record<string, string>>(
    {},
  );

  const ratingLabJobQuery = useQuery({
    queryKey: ["rating-lab", "job"],
    queryFn: fetchRatingLabJob,
    enabled: !desktop,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  useEffect(() => {
    if (data.maniaRating?.versions) {
      const next: Record<string, string> = {};
      for (const v of data.maniaRating.versions) {
        next[v.id] = v.executablePath ?? "";
      }
      setManiaExeDrafts(next);
    }
  }, [data.maniaRating?.versions]);

  const maniaRatingMut = useMutation({
    mutationFn: (executables: Record<string, string | null>) =>
      patchSettings({ maniaRatingExecutables: executables }),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      if (next.maniaRating?.versions) {
        const drafts: Record<string, string> = {};
        for (const v of next.maniaRating.versions) {
          drafts[v.id] = v.executablePath ?? "";
        }
        setManiaExeDrafts(drafts);
      }
    },
  });

  const startRatingLab = useMutation({
    mutationFn: (versionId: string) =>
      startRatingLabJob({ versionId, query: "mode:mania" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "job"] });
    },
  });

  const stopRatingLab = useMutation({
    mutationFn: stopRatingLabJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "job"] });
    },
  });

  if (desktop) return null;

  const maniaRating = data.maniaRating;
  const maniaVersions = maniaRating?.versions ?? [];
  const maniaJob = ratingLabJobQuery.data ?? maniaRating?.job;
  const maniaCoverage = maniaJob?.coverage;
  const maniaRunning =
    maniaJob?.status === "running" || maniaJob?.status === "stopping";
  const maniaProgressPct =
    maniaCoverage && maniaCoverage.maniaTotal > 0
      ? Math.min(
          100,
          Math.round((maniaCoverage.computed / maniaCoverage.maniaTotal) * 100),
        )
      : 0;
  const defaultExperimentVersion =
    maniaVersions.find((v) => v.id === "enissay-accuracy-change")?.id ??
    maniaVersions[1]?.id ??
    maniaVersions[0]?.id ??
    "";

  return (
    <section
      id={pageSectionDomId("mania-rating-lab")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.maniaRatingLab}
      </h2>
      {dict?.settings.maniaRatingLabDesc ? (
        <p className="mt-1 text-sm text-muted">
          {dict.settings.maniaRatingLabDesc}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Calculator binaries built from osu!lazer branches (see{" "}
          <code className="text-xs">docs/mania-rating-lab.md</code>). Used by
          the{" "}
          <Link to="/rating-lab" className="text-accent hover:underline">
            Rating Lab
          </Link>{" "}
          page to compare SR and SS PP.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {maniaVersions.map((version) => {
          const draft = maniaExeDrafts[version.id] ?? "";
          const saved = version.executablePath ?? "";
          const dirty = (draft.trim() || null) !== (saved || null);
          const optional = version.usesImport === true;
          return (
            <label key={version.id} className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-faint">
                {version.label}
                {optional ? ` ${dict?.settings.optional ?? "(optional)"}` : ""}
              </span>
              <input
                type="text"
                value={draft}
                onChange={(e) =>
                  setManiaExeDrafts((prev) => ({
                    ...prev,
                    [version.id]: e.target.value,
                  }))
                }
                placeholder={
                  optional
                    ? dict?.settings.optionalPlaceholder
                    : t(dict?.settings.calcPathPlaceholder, {
                        id: version.id,
                      })
                }
                disabled={maniaRatingMut.isPending}
                className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-faint">
                {version.description}
              </p>
              {dirty ? (
                <button
                  type="button"
                  className="rx-btn mt-2"
                  disabled={maniaRatingMut.isPending}
                  onClick={() =>
                    maniaRatingMut.mutate({
                      [version.id]: draft.trim() ? draft.trim() : null,
                    })
                  }
                >
                  {t(dict?.settings.saveLabel, { label: version.label })}
                </button>
              ) : null}
            </label>
          );
        })}
      </div>

      {maniaCoverage ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
            <span>
              <span className="font-semibold text-ink">
                {maniaCoverage.computed.toLocaleString()}
              </span>
              {" / "}
              {t(dict?.settings.maniaMaps, {
                count: maniaCoverage.maniaTotal.toLocaleString(),
              })}
              {maniaJob?.versionId ? ` (${maniaJob.versionId})` : ""}
            </span>
            <span>
              {t(dict?.settings.remaining, {
                count: maniaCoverage.missing.toLocaleString(),
              })}
            </span>
            {maniaCoverage.failed > 0 ? (
              <span className="text-danger/90">
                {t(dict?.settings.failed, {
                  count: maniaCoverage.failed.toLocaleString(),
                })}
              </span>
            ) : null}
          </div>

          <div className="h-2 overflow-hidden rounded bg-elevated">
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${maniaProgressPct}%` }}
            />
          </div>

          <p className="text-xs text-faint">
            {statusLabel(dict, maniaJob?.status)}
            {maniaRunning
              ? ` · ${t(dict?.settings.computedThisRun, {
                  count: maniaJob?.computedThisRun.toLocaleString() ?? "0",
                })}`
              : null}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={
            maniaRunning ||
            startRatingLab.isPending ||
            !defaultExperimentVersion ||
            (maniaCoverage?.missing ?? 0) === 0
          }
          onClick={() => startRatingLab.mutate(defaultExperimentVersion)}
        >
          {maniaRunning
            ? dict?.settings.computing
            : dict?.settings.backfillRatings}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={!maniaRunning || stopRatingLab.isPending}
          onClick={() => stopRatingLab.mutate()}
        >
          {maniaJob?.status === "stopping"
            ? dict?.settings.stopping
            : dict?.settings.stop}
        </button>
      </div>

      {maniaRatingMut.error ? (
        <p className="mt-3 text-sm text-danger">
          {maniaRatingMut.error.message}
        </p>
      ) : null}
      {maniaJob?.error ? (
        <p className="mt-3 text-sm text-danger">{maniaJob.error}</p>
      ) : null}
    </section>
  );
}
