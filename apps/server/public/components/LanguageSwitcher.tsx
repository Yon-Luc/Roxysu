import { i18n } from "@roxysu/i18n";
import type { Locale } from "@roxysu/i18n";
import { useLanguage, setLanguage } from "../lib/language";

const LANGUAGE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
};

export function LanguageSwitcher() {
  const lang = useLanguage();

  return (
    <select
      className="rx-select w-full px-2 py-2 text-sm"
      value={lang}
      onChange={(e) => setLanguage(e.target.value as Locale)}
      aria-label="Language"
      title="Language"
    >
      {i18n.locales.map((locale) => (
        <option key={locale} value={locale}>
          {LANGUAGE_LABELS[locale]}
        </option>
      ))}
    </select>
  );
}
