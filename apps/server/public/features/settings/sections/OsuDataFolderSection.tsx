import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict, t } from "../../../lib/i18n";
import {
  pathSourceLabel,
  pathStatusLabel,
} from "../../../lib/settingsLabels";

export function OsuDataFolderSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const paths = data.paths;
  const [draft, setDraft] = useState(paths.osuDataPath ?? "");

  useEffect(() => {
    setDraft(paths.osuDataPath ?? "");
  }, [paths.osuDataPath]);

  const pathMut = useMutation({
    mutationFn: (osuDataPath: string | null) => patchSettings({ osuDataPath }),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      setDraft(next.paths.osuDataPath ?? "");
    },
  });

  const dirty = (draft.trim() || null) !== (paths.osuDataPath ?? null);

  return (
    <section
      id={pageSectionDomId("osu-lazer-data-folder")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.lazerDataFolder}
      </h2>
      {dict?.settings.lazerDataFolderDesc ? (
        <p className="mt-1 text-sm text-muted">
          {dict.settings.lazerDataFolderDesc}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Folder that contains <span className="font-mono">client.realm</span>{" "}
          and <span className="font-mono">files/</span>. Override when the
          default path is wrong (Flatpak, custom install, etc.).
        </p>
      )}

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          {dict?.settings.customPath}
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={paths.resolvedOsuDataPath}
          disabled={pathMut.isPending || paths.source === "env"}
          className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="mt-3 space-y-1 text-sm text-muted">
        <p>
          {(() => {
            const parts = t(dict?.settings.usingPath, {
              path: "⟦PATH⟧",
              source: pathSourceLabel(dict, paths.source),
            }).split("⟦PATH⟧");
            return (
              <>
                {parts[0]}
                <span className="font-mono text-ink">
                  {paths.resolvedOsuDataPath}
                </span>
                {parts[1]}
              </>
            );
          })()}
        </p>
        <p className="font-mono text-xs text-faint">
          realm → {paths.resolvedRealmPath}
        </p>
        <p className="text-xs">{pathStatusLabel(dict, paths.status)}</p>
        {paths.source === "env" ? (
          <p className="text-xs text-warning/90">
            <span className="font-mono">OSU_DATA_PATH</span> or{" "}
            <span className="font-mono">REALM_PATH</span> —{" "}
            {dict?.settings.envWins}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={
            pathMut.isPending ||
            paths.source === "env" ||
            !dirty ||
            !draft.trim()
          }
          onClick={() => pathMut.mutate(draft.trim())}
        >
          {pathMut.isPending ? dict?.settings.saving : dict?.settings.savePath}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={
            pathMut.isPending ||
            paths.source === "env" ||
            paths.osuDataPath == null
          }
          onClick={() => pathMut.mutate(null)}
        >
          {dict?.settings.clearOverride}
        </button>
      </div>

      {pathMut.error ? (
        <p className="mt-3 text-sm text-danger">{pathMut.error.message}</p>
      ) : null}
    </section>
  );
}
