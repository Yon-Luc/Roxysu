import { useQuery } from "@tanstack/react-query";
import { HubLoginButton } from "./HubLoginButton";
import { fetchHubMe, useHubJwt, useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";

const loginClass =
  "inline-flex shrink-0 items-center rounded-full bg-elevated px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:bg-highlight";

/** App-wide Hub osu! session: login control, or avatar and username. */
export function HubSessionChip() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const { dict } = useAppDict();
  const me = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    enabled: Boolean(jwt),
    staleTime: 60_000,
  });

  if (!jwt) {
    return (
      <HubLoginButton className={loginClass} title={dict?.hub?.loginButtonLabel}>
        {dict?.hub?.loginShort ?? "Log in"}
      </HubLoginButton>
    );
  }

  if (!me.data) {
    return (
      <span
        className="size-8 shrink-0 animate-pulse rounded-full bg-elevated"
        aria-hidden
      />
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2" title={me.data.username}>
      {me.data.avatarUrl ? (
        <img
          src={me.data.avatarUrl}
          alt=""
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="size-8 shrink-0 rounded-full bg-elevated" />
      )}
      <span className="max-w-[6.5rem] truncate text-sm font-semibold text-ink">
        {me.data.username}
      </span>
    </span>
  );
}
