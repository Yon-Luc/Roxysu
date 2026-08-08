import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function ScoreUsernameSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const scoresUsernameMut = useMutation({
    mutationFn: (scoresUsernameFilter: string | string[]) =>
      patchSettings({ scoresUsernameFilter }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  const scores = data.scores;

  return (
    <section
      id={pageSectionDomId("score-username")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.scoreUsername}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.scoreUsernameDesc}
      </p>
      {scores ? (
        <>
          <div className="mt-4 space-y-2">
            <label
              className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                scores.mode === "auto"
                  ? "bg-accent-glow ring-1 ring-accent/50"
                  : "bg-elevated/50 hover:bg-elevated"
              }`}
            >
              <input
                type="radio"
                name="scoresUsernameMode"
                checked={scores.mode === "auto"}
                disabled={scoresUsernameMut.isPending}
                onChange={() => scoresUsernameMut.mutate("auto")}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                <div className="font-bold text-ink">
                  {dict?.settings.auto}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {dict?.settings.mostCommonUsername}
                  {scores.mostCommonUsername
                    ? ` (${scores.mostCommonUsername})`
                    : ""}
                </div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                scores.mode === "all"
                  ? "bg-accent-glow ring-1 ring-accent/50"
                  : "bg-elevated/50 hover:bg-elevated"
              }`}
            >
              <input
                type="radio"
                name="scoresUsernameMode"
                checked={scores.mode === "all"}
                disabled={scoresUsernameMut.isPending}
                onChange={() => scoresUsernameMut.mutate("*")}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                <div className="font-bold text-ink">
                  {dict?.settings.allUsernames}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {dict?.settings.allUsernamesDesc}
                </div>
              </div>
            </label>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">
              {dict?.settings.selectedUsernames}
            </div>
            {scores.usernames.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                {dict?.settings.noUsernames}
              </p>
            ) : (
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-elevated/40 p-2">
                {scores.usernames.map((u) => {
                  const checked =
                    scores.mode === "selected" &&
                    scores.selectedUsernames.includes(u.username);
                  return (
                    <label
                      key={u.username}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition ${
                        checked
                          ? "bg-accent-glow ring-1 ring-accent/40"
                          : "hover:bg-elevated"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={scoresUsernameMut.isPending}
                        onChange={() => {
                          const current =
                            scores.mode === "selected"
                              ? scores.selectedUsernames
                              : [];
                          const next = checked
                            ? current.filter((name) => name !== u.username)
                            : [...current, u.username];
                          if (next.length === 0) {
                            scoresUsernameMut.mutate("auto");
                            return;
                          }
                          scoresUsernameMut.mutate(next);
                        }}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">
                        {u.username}
                      </span>
                      <span className="font-mono text-xs text-faint">
                        {u.count}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {scores.mode === "auto" &&
          scores.resolvedUsernames &&
          scores.resolvedUsernames.length > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {dict?.settings.currentlyFilteringTo}{" "}
              <span className="font-semibold text-ink">
                {scores.resolvedUsernames.join(", ")}
              </span>
              .
            </p>
          ) : null}
          {scores.mode === "selected" &&
          scores.selectedUsernames.length > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {dict?.settings.showing}{" "}
              <span className="font-semibold text-ink">
                {scores.selectedUsernames.join(", ")}
              </span>
              .
            </p>
          ) : null}
        </>
      ) : null}
      {scoresUsernameMut.isPending ? (
        <p className="mt-3 text-sm text-muted">
          {dict?.settings.updatingFilter}
        </p>
      ) : null}
      {scoresUsernameMut.error ? (
        <p className="mt-3 text-sm text-rose-300">
          {scoresUsernameMut.error.message}
        </p>
      ) : null}
    </section>
  );
}
