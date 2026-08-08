import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict, t } from "../../../lib/i18n";

export function MasteryFormulaSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

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

  return (
    <section
      id={pageSectionDomId("mastery-formula")}
      className="rx-panel scroll-mt-6 p-5"
    >
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
                  {t(dict?.settings.idPrefix, { id: f.id })}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      {mut.isPending ? (
        <p className="mt-3 text-sm text-muted">
          {dict?.settings.recomputingMastery}
        </p>
      ) : null}
      {mut.error ? (
        <p className="mt-3 text-sm text-rose-300">{mut.error.message}</p>
      ) : null}
    </section>
  );
}
