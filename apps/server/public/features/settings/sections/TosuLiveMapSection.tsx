import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function TosuLiveMapSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const tosu = data.tosu;
  const [hostDraft, setHostDraft] = useState(tosu.host);
  const [exeDraft, setExeDraft] = useState(tosu.executablePath ?? "");

  useEffect(() => {
    setHostDraft(tosu.host);
    setExeDraft(tosu.executablePath ?? "");
  }, [tosu.host, tosu.executablePath]);

  const tosuMut = useMutation({
    mutationFn: (body: {
      tosuEnabled?: boolean;
      tosuHost?: string;
      tosuExecutablePath?: string | null;
    }) => patchSettings(body),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      if (next.tosu) {
        setHostDraft(next.tosu.host);
        setExeDraft(next.tosu.executablePath ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["tosu", "live"] });
    },
  });

  const hostDirty = hostDraft.trim() !== tosu.host;
  const exeDirty = (exeDraft.trim() || null) !== (tosu.executablePath ?? null);

  return (
    <section
      id={pageSectionDomId("tosu-live-map")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.tosuLiveMap}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.tosuLiveMapDesc}
      </p>

      <label className="mt-4 flex cursor-pointer gap-3 rounded-xl bg-elevated/50 px-4 py-3">
        <input
          type="checkbox"
          checked={tosu.enabled}
          disabled={tosuMut.isPending}
          onChange={(e) => tosuMut.mutate({ tosuEnabled: e.target.checked })}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <div>
          <div className="font-bold text-ink">
            {dict?.settings.enableTosu}
          </div>
          <div className="mt-0.5 text-sm text-muted">
            {dict?.settings.enableTosuDesc}
          </div>
        </div>
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          {dict?.settings.host}
        </span>
        <input
          type="text"
          value={hostDraft}
          onChange={(e) => setHostDraft(e.target.value)}
          placeholder={tosu.defaultHost}
          disabled={tosuMut.isPending}
          className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          {dict?.settings.executablePath}
        </span>
        <input
          type="text"
          value={exeDraft}
          onChange={(e) => setExeDraft(e.target.value)}
          placeholder="/path/to/tosu"
          disabled={tosuMut.isPending}
          className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={tosuMut.isPending || (!hostDirty && !exeDirty)}
          onClick={() =>
            tosuMut.mutate({
              ...(hostDirty
                ? { tosuHost: hostDraft.trim() || tosu.defaultHost }
                : {}),
              ...(exeDirty
                ? {
                    tosuExecutablePath: exeDraft.trim()
                      ? exeDraft.trim()
                      : null,
                  }
                : {}),
            })
          }
        >
          {tosuMut.isPending ? dict?.settings.saving : dict?.settings.saveTosu}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={tosuMut.isPending || tosu.executablePath == null}
          onClick={() => tosuMut.mutate({ tosuExecutablePath: null })}
        >
          {dict?.settings.clearExecutable}
        </button>
      </div>

      {tosuMut.error ? (
        <p className="mt-3 text-sm text-rose-300">{tosuMut.error.message}</p>
      ) : null}
    </section>
  );
}
