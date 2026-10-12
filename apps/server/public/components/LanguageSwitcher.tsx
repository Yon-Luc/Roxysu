import { i18n } from "@roxysu/i18n";
import type { Locale } from "@roxysu/i18n";
import { useAppDict } from "../lib/i18n";
import { useLanguage, setLanguage } from "../lib/language";

const LANGUAGE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
};

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const lang = useLanguage();
  const { dict } = useAppDict();
  const label = dict?.common.language ?? "Language";

  return (
    <select
      className={`rx-select min-w-0 px-2 py-2 text-sm ${className}`.trim()}
      value={lang}
      onChange={(e) => setLanguage(e.target.value as Locale)}
      aria-label={label}
      title={label}
    >
      {i18n.locales.map((locale) => (
        <option key={locale} value={locale}>
          {LANGUAGE_LABELS[locale]}
        </option>
      ))}
    </select>
  );
}
