import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHubMe, useHubJwt, useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";
import {
  fetchPublicBmsActivity,
  fetchPublicBmsCatalogue,
  fetchPublicBmsProfile,
  fetchPublicBmsScores,
  fetchPublicBmsSessions,
  fetchPublicBmsTables,
  patchBmsPrivacy,
} from "./api";
import { BmsProfileView } from "./BmsProfileView";

export function BmsPlayerPage({
  username,
  view,
}: {
  username: string;
  view: "overview" | "scores" | "tables";
}) {
  const { dict } = useAppDict();
  const hubUrl = useHubUrl();
  const token = useHubJwt();
  const queryClient = useQueryClient();
  const [variant, setVariant] = useState<string | null>(null);
  const [achievement, setAchievement] = useState("aa");
  const me = useQuery({
    queryKey: ["hub-me", hubUrl, token],
    queryFn: () => fetchHubMe(hubUrl, token!),
    enabled: !!token,
  });
  const profile = useQuery({
    queryKey: ["bms-public-profile", hubUrl, username, token],
    queryFn: () => fetchPublicBmsProfile(hubUrl, username, token),
  });
  const selected = variant ?? profile.data?.variants[0]?.variantId ?? "standard";
  const scores = useQuery({
    queryKey: ["bms-public-scores", hubUrl, username, selected, token],
    queryFn: () => fetchPublicBmsScores(hubUrl, username, selected, token),
    enabled: profile.isSuccess && view !== "tables",
  });
  const activity = useQuery({
    queryKey: ["bms-public-activity", hubUrl, username, token],
    queryFn: () => fetchPublicBmsActivity(hubUrl, username, token),
    enabled: profile.isSuccess && view === "overview",
  });
  const sessions = useQuery({
    queryKey: ["bms-public-sessions", hubUrl, username, selected, token],
    queryFn: () => fetchPublicBmsSessions(hubUrl, username, selected, token),
    enabled: profile.isSuccess && view !== "tables",
  });
  const catalogue = useQuery({
    queryKey: ["bms-public-catalogue", hubUrl],
    queryFn: () => fetchPublicBmsCatalogue(hubUrl),
    enabled: view === "tables",
  });
  const firstTable = catalogue.data?.tables.find((table) => table.latestVersionId) ?? null;
  const table = useQuery({
    queryKey: ["bms-public-table", hubUrl, username, firstTable?.id, selected, achievement, token],
    queryFn: () =>
      fetchPublicBmsTables(hubUrl, username, firstTable!.id, selected, achievement, token),
    enabled: view === "tables" && !!firstTable && profile.isSuccess,
  });
  const privacy = useMutation({
    mutationFn: (profilePublic: boolean) => patchBmsPrivacy(hubUrl, token!, profilePublic),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bms-public-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
    },
  });
  const owner =
    !!me.data && me.data.username.toLowerCase() === username.toLowerCase();
  const hidden =
    profile.error instanceof Error && /not found|404/i.test(profile.error.message);

  return (
    <div>
      {owner && profile.data ? (
        <div className="mx-auto flex w-full max-w-5xl justify-end px-4 pt-4">
          <button
            type="button"
            className="rx-btn"
            onClick={() => privacy.mutate(!profile.data.profilePublic)}
          >
            {profile.data.profilePublic
              ? (dict?.bms?.profilePublic ?? "Public profile")
              : (dict?.bms?.profilePrivate ?? "Private profile")}
          </button>
        </div>
      ) : null}
      <BmsProfileView
        title={dict?.bms?.publicTitle ?? "BMS profile"}
        username={profile.data?.username ?? username}
        countryCode={profile.data?.countryCode}
        plays={profile.data?.plays ?? 0}
        variantId={selected}
        variants={profile.data?.variants ?? []}
        scores={scores.data?.scores ?? []}
        sessions={sessions.data?.sessions ?? []}
        tables={table.data ? [table.data] : []}
        activity={view === "overview" ? activity.data?.days : undefined}
        achievement={achievement}
        onVariant={setVariant}
        onAchievement={setAchievement}
        showScores={view !== "tables"}
        showTables={view === "tables"}
        local={false}
        error={
          hidden
            ? (dict?.bms?.privateHidden ?? "This profile is private.")
            : profile.error instanceof Error
              ? profile.error.message
              : null
        }
      />
    </div>
  );
}
