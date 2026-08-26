import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function OverlayHostSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const hostUrl = data.overlay.hostUrl;
  const enabled = data.overlay.enabled;
  const [draft, setDraft] = useState(hostUrl ?? "");

  useEffect(() => {
    setDraft(hostUrl ?? "");
  }, [hostUrl]);

  const urlMut = useMutation({
    mutationFn: (body: { overlayHostUrl?: string | null; overlayEnabled?: boolean }) =>
      patchSettings(body),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      setDraft(next.overlay.hostUrl ?? "");
    },
  });

  const dirty = (draft.trim() || null) !== (hostUrl ?? null);

  return (
    <section
      id={pageSectionDomId("in-game-overlay")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.overlayHost ?? "In-game overlay"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.overlayHostDesc ??
          "URL loaded by the desktop app's in-game overlay host. Include ?profile=<name> to pick a saved layout from the overlay editor. Saving restarts the overlay within a few seconds."}
      </p>

      <label className="mt-4 flex cursor-pointer gap-3 rounded-xl bg-elevated/50 px-4 py-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={urlMut.isPending}
          onChange={(e) => urlMut.mutate({ overlayEnabled: e.target.checked })}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <div>
          <div className="font-bold text-ink">
            {dict?.settings.overlayEnable ?? "Enable in-game overlay"}
          </div>
          <div className="mt-0.5 text-sm text-muted">
            {dict?.settings.overlayEnableDesc ??
              "Desktop app spawns the Wayland overlay window. Turning this off stops it within a few seconds."}
          </div>
        </div>
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          {dict?.settings.overlayHostLabel ?? "HUD URL"}
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="http://127.0.0.1:4321/#/overlay?bg=clear&profile=Classic"
          disabled={urlMut.isPending}
          className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={urlMut.isPending || !dirty || !draft.trim()}
          onClick={() => urlMut.mutate({ overlayHostUrl: draft.trim() })}
        >
          {urlMut.isPending
            ? dict?.settings.saving ?? "Saving…"
            : dict?.settings.overlayHostSave ?? "Save URL"}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={urlMut.isPending || hostUrl == null}
          onClick={() => urlMut.mutate({ overlayHostUrl: null })}
        >
          {dict?.settings.overlayHostClear ?? "Use default"}
        </button>
      </div>

      {urlMut.error ? (
        <p className="mt-3 text-sm text-danger">{urlMut.error.message}</p>
      ) : null}
    </section>
  );
}
