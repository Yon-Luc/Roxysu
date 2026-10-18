import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppDict } from "../../lib/i18n";
import { fetchLocalBmsProfile, fetchLocalBmsSessions, fetchLocalBmsTables } from "./api";
import { BmsProfileView } from "./BmsProfileView";

export function BmsLocalPage() {
  const { dict } = useAppDict();
  const [variant, setVariant] = useState<string | null>(null);
  const [achievement, setAchievement] = useState("aa");
  const profile = useQuery({
    queryKey: ["bms-local-profile", variant],
    queryFn: () => fetchLocalBmsProfile(variant),
    placeholderData: (previous) => previous,
  });
  const selected = variant ?? profile.data?.variantId ?? null;
  const sessions = useQuery({
    queryKey: ["bms-local-sessions", selected],
    queryFn: () => fetchLocalBmsSessions(selected),
    enabled: selected != null,
    placeholderData: (previous) => previous,
  });
  const tables = useQuery({
    queryKey: ["bms-local-tables", selected, achievement],
    queryFn: () => fetchLocalBmsTables(selected!, achievement),
    enabled: selected != null,
    placeholderData: (previous) => previous,
  });

  return (
    <BmsProfileView
      title={dict?.bms?.localTitle ?? "Your BMS profile"}
      subtitle={dict?.bms?.offline}
      username={profile.data?.username}
      plays={profile.data?.plays ?? 0}
      variantId={selected}
      variants={profile.data?.variants ?? []}
      scores={profile.data?.recent ?? []}
      sessions={sessions.data?.sessions ?? []}
      tables={tables.data?.tables ?? []}
      achievement={achievement}
      onVariant={setVariant}
      onAchievement={setAchievement}
      showScores
      showTables
      local
      error={profile.error instanceof Error ? profile.error.message : null}
    />
  );
}
