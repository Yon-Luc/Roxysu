import { setTheme, themeOptions, useTheme } from "../../../lib/theme";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function AppearanceSection() {
  const { dict } = useAppDict();
  const themeMode = useTheme();

  return (
    <section
      id={pageSectionDomId("appearance")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.appearance}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.appearanceDesc}
      </p>
      <div className="mt-4 space-y-2">
        {themeOptions().map((opt) => {
          const active = opt.id === themeMode;
          const optDict = dict?.settings.theme[opt.id];
          return (
            <label
              key={opt.id}
              className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                active
                  ? "bg-accent-glow ring-1 ring-accent/50"
                  : "bg-elevated/50 hover:bg-elevated"
              }`}
            >
              <input
                type="radio"
                name="theme"
                checked={active}
                onChange={() => setTheme(opt.id)}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                <div className="font-bold text-ink">
                  {optDict?.label ?? opt.label}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {optDict?.description ?? opt.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}
