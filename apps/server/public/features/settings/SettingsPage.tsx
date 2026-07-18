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
    return <p className="text-[#8b93a7]">Loading settings…</p>;
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
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[#8b93a7]">
          Switch mastery formulas to experiment — changing recomputes all levels.
        </p>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#151922] p-4">
        <h2 className="text-sm font-medium text-[#a8b0c0]">Mastery formula</h2>
        <div className="mt-4 space-y-3">
          {data.mastery.formulas.map((f) => {
            const active = f.id === data.mastery.formulaId;
            return (
              <label
                key={f.id}
                className={`flex cursor-pointer gap-3 rounded-md border px-3 py-3 ${
                  active
                    ? "border-white/25 bg-white/5"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="masteryFormula"
                  checked={active}
                  disabled={mut.isPending}
                  onChange={() => mut.mutate(f.id)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-white">{f.label}</div>
                  <div className="mt-0.5 text-sm text-[#8b93a7]">
                    {f.description}
                  </div>
                  <div className="mt-1 font-mono text-xs text-[#6b7385]">
                    id: {f.id}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {mut.isPending ? (
          <p className="mt-3 text-sm text-[#8b93a7]">Recomputing mastery…</p>
        ) : null}
        {mut.error ? (
          <p className="mt-3 text-sm text-rose-300">{mut.error.message}</p>
        ) : null}
      </section>
    </div>
  );
}
