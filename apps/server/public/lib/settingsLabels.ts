import type { Dictionary } from "@roxysu/i18n";

export function pathSourceLabel(
  dict: Dictionary["app"] | undefined,
  source: string,
): string {
  switch (source) {
    case "env":
      return dict?.settings.pathSource.env ?? "from environment";
    case "settings":
      return dict?.settings.pathSource.settings ?? "from settings";
    default:
      return dict?.settings.pathSource.default ?? "default";
  }
}

export function pathStatusLabel(
  dict: Dictionary["app"] | undefined,
  status: {
    exists: boolean;
    hasRealm: boolean;
    hasFiles: boolean;
  },
): string {
  if (!status.exists)
    return dict?.settings.pathStatus.dirNotFound ?? "Directory not found";
  const bits = [
    status.hasRealm
      ? dict?.settings.pathStatus.realmFound ?? "client.realm found"
      : dict?.settings.pathStatus.realmMissing ?? "client.realm missing",
    status.hasFiles
      ? dict?.settings.pathStatus.filesFound ?? "files/ found"
      : dict?.settings.pathStatus.filesMissing ?? "files/ missing",
  ];
  return bits.join(" · ");
}

export function statusLabel(
  dict: Dictionary["app"] | undefined,
  status: string | undefined,
): string {
  switch (status) {
    case "running":
      return dict?.settings.jobStatus.running ?? "Running";
    case "stopping":
      return dict?.settings.jobStatus.stopping ?? "Stopping after current batch";
    case "completed":
      return dict?.settings.jobStatus.completed ?? "Complete";
    case "error":
      return dict?.settings.jobStatus.error ?? "Stopped with error";
    default:
      return dict?.settings.jobStatus.idle ?? "Idle";
  }
}
