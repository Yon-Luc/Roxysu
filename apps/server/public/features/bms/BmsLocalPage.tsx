import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppDict } from "../../lib/i18n";
import {
  fetchLocalBmsProfile,
  fetchLocalBmsScores,
  fetchLocalBmsSessions,
  fetchLocalBmsTables,
} from "./api";
import { BmsProfileView } from "./BmsProfileView";

export function BmsLocalPage() {
  const { dict } = useAppDict();
  const [variant, setVariant] = useState<string | null>(null);
  const [achievement, setAchievement] = useState("aa");
  const [scoreCursor, setScoreCursor] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ["bms-local-profile", variant],
    queryFn: () => fetchLocalBmsProfile(variant),
    placeholderData: (previous) => previous,
  });
  const selected = variant ?? profile.data?.variantId ?? null;
  const scores = useQuery({
    queryKey: ["bms-local-scores", selected, scoreCursor],
    queryFn: () => fetchLocalBmsScores(selected, scoreCursor),
    enabled: selected != null,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === selected ? previous : undefined,
  });
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
  const profilePending = profile.isPending && profile.data == null;
  const scoresPending = selected == null ? profilePending : scores.isPending && scores.data == null;

  return (
    <BmsProfileView
      title={dict?.bms?.localTitle ?? "Your BMS profile"}
      subtitle={dict?.bms?.offline}
      username={profile.data?.username}
      plays={profile.data?.plays ?? 0}
      variantId={selected}
      variants={profile.data?.variants ?? []}
      scores={scores.data?.scores ?? []}
      sessions={sessions.data?.sessions ?? []}
      tables={tables.data?.tables ?? []}
      achievement={achievement}
      onVariant={(next) => {
        setVariant(next);
        setScoreCursor(null);
      }}
      onAchievement={setAchievement}
      showScores
      showTables
      local
      tablesPending={tables.isPending && tables.data == null}
      profilePending={profilePending}
      scoresPending={scoresPending}
      sessionsPending={selected == null ? profilePending : sessions.isPending && sessions.data == null}
      scoreCursor={scoreCursor}
      scoreNextCursor={scores.data?.nextCursor ?? null}
      onScoreCursor={setScoreCursor}
      error={profile.error instanceof Error ? profile.error.message : scores.error instanceof Error ? scores.error.message : null}
    />
  );
}
