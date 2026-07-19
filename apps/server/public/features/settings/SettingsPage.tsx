import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, patchSettings } from "../../lib/api";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const mut = useMutation({
    mutationFn: (masteryFormulaId: string) =>
      patchSettings({ masteryFormulaId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (isLoading) {
    return <p className="text-muted">Loading settings…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load settings: {error?.message ?? "unknown"}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="rx-title">Settings</h1>
        <p className="rx-subtitle">
          Switch mastery formulas to experiment — changing recomputes all levels.
        </p>
      </div>

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">Mastery formula</h2>
        <div className="mt-4 space-y-2">
          {data.mastery.formulas.map((f) => {
            const active = f.id === data.mastery.formulaId;
            return (
              <label
                key={f.id}
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  active
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="masteryFormula"
                  checked={active}
                  disabled={mut.isPending}
                  onChange={() => mut.mutate(f.id)}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">{f.label}</div>
                  <div className="mt-0.5 text-sm text-muted">{f.description}</div>
                  <div className="mt-1 font-mono text-xs text-faint">
                    id: {f.id}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {mut.isPending ? (
          <p className="mt-3 text-sm text-muted">Recomputing mastery…</p>
        ) : null}
        {mut.error ? (
          <p className="mt-3 text-sm text-rose-300">{mut.error.message}</p>
        ) : null}
      </section>
    </div>
  );
}
