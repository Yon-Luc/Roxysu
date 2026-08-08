import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function LiveSyncSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const syncMut = useMutation({
    mutationFn: (pauseWhenUnfocused: boolean) =>
      patchSettings({ pauseWhenUnfocused }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["system", "status"] });
    },
  });

  return (
    <section
      id={pageSectionDomId("live-sync")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.liveSync}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.liveSyncDesc}
      </p>
      <label className="mt-4 flex cursor-pointer gap-3 rounded-xl bg-elevated/50 px-4 py-3 hover:bg-elevated">
        <input
          type="checkbox"
          checked={data.sync.pauseWhenUnfocused}
          disabled={syncMut.isPending}
          onChange={(e) => syncMut.mutate(e.target.checked)}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <div>
          <div className="font-bold text-ink">
            {dict?.settings.pauseWhenUnfocused}
          </div>
          <div className="mt-0.5 text-sm text-muted">
            {dict?.settings.pauseWhenUnfocusedDesc}
          </div>
        </div>
      </label>
      {syncMut.error ? (
        <p className="mt-3 text-sm text-rose-300">{syncMut.error.message}</p>
      ) : null}
    </section>
  );
}
