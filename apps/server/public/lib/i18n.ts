import { useI18n } from "@roxysu/i18n/react";
import type { Dictionary } from "@roxysu/i18n";
import { useLanguage } from "./language";

export function useAppDict(): {
  dict: Dictionary["app"] | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const lang = useLanguage();
  const { data, isLoading, isError } = useI18n({ pages: ["app"], lang });
  return { dict: data.app, isLoading, isError };
}

export function t(
  template: string | undefined,
  vars: Record<string, string | number> = {},
): string {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] != null ? String(vars[key]) : `{{${key}}}`,
  );
}
