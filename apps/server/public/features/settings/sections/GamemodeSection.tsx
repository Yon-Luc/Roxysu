import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function GamemodeSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const scoresGamemodeMut = useMutation({
    mutationFn: (scoresGamemodeFilter: string) =>
      patchSettings({ scoresGamemodeFilter }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });

  const gamemode = data.gamemode;

  return (
    <section
      id={pageSectionDomId("gamemode")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.gamemode}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.gamemodeDesc}
      </p>
      {gamemode ? (
        <>
          <div className="mt-4 space-y-2">
            <label
              className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                gamemode.mode === "auto"
                  ? "bg-accent-glow ring-1 ring-accent/50"
                  : "bg-elevated/50 hover:bg-elevated"
              }`}
            >
              <input
                type="radio"
                name="scoresGamemode"
                checked={gamemode.mode === "auto"}
                disabled={scoresGamemodeMut.isPending}
                onChange={() => scoresGamemodeMut.mutate("auto")}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                <div className="font-bold text-ink">
                  {dict?.settings.auto}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {dict?.settings.mostScores}
                  {gamemode.mostCommonGamemode
                    ? ` (${
                        gamemode.gamemodes.find(
                          (g) => g.id === gamemode.mostCommonGamemode,
                        )?.label ?? gamemode.mostCommonGamemode
                      })`
                    : ""}
                </div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                gamemode.mode === "all"
                  ? "bg-accent-glow ring-1 ring-accent/50"
                  : "bg-elevated/50 hover:bg-elevated"
              }`}
            >
              <input
                type="radio"
                name="scoresGamemode"
                checked={gamemode.mode === "all"}
                disabled={scoresGamemodeMut.isPending}
                onChange={() => scoresGamemodeMut.mutate("*")}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                <div className="font-bold text-ink">
                  {dict?.settings.allGamemodes}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {dict?.settings.allGamemodesDesc}
                </div>
              </div>
            </label>
          </div>

          <div className="mt-4 space-y-2">
            {gamemode.gamemodes.map((g) => {
              const checked =
                gamemode.mode === "selected" &&
                gamemode.selectedGamemode === g.id;
              return (
                <label
                  key={g.id}
                  className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                    checked
                      ? "bg-accent-glow ring-1 ring-accent/50"
                      : "bg-elevated/50 hover:bg-elevated"
                  }`}
                >
                  <input
                    type="radio"
                    name="scoresGamemode"
                    checked={checked}
                    disabled={scoresGamemodeMut.isPending}
                    onChange={() => scoresGamemodeMut.mutate(g.id)}
                    className="mt-1 accent-[var(--color-accent)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-ink">
                      {g.label}{" "}
                      <span className="font-normal text-faint">
                        ({g.shortLabel})
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-faint">
                    {g.count}
                  </span>
                </label>
              );
            })}
          </div>

          {gamemode.mode === "auto" && gamemode.resolvedGamemode ? (
            <p className="mt-2 text-sm text-muted">
              {dict?.settings.currentlyFilteringTo}{" "}
              <span className="font-semibold text-ink">
                {gamemode.gamemodes.find(
                  (g) => g.id === gamemode.resolvedGamemode,
                )?.label ?? gamemode.resolvedGamemode}
              </span>
              .
            </p>
          ) : null}
          {gamemode.mode === "selected" && gamemode.selectedGamemode ? (
            <p className="mt-2 text-sm text-muted">
              {dict?.settings.showing}{" "}
              <span className="font-semibold text-ink">
                {gamemode.gamemodes.find(
                  (g) => g.id === gamemode.selectedGamemode,
                )?.label ?? gamemode.selectedGamemode}
              </span>{" "}
              {dict?.settings.onlySuffix}.
            </p>
          ) : null}
        </>
      ) : null}
      {scoresGamemodeMut.isPending ? (
        <p className="mt-3 text-sm text-muted">
          {dict?.settings.updatingFilter}
        </p>
      ) : null}
      {scoresGamemodeMut.error ? (
        <p className="mt-3 text-sm text-danger">
          {scoresGamemodeMut.error.message}
        </p>
      ) : null}
    </section>
  );
}
