const OSU_TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const OSU_ME_URL = "https://osu.ppy.sh/api/v2/me";

export interface OsuUser {
  id: number;
  username: string;
  avatar_url: string;
}

/**
 * Exchange an OAuth authorization code for an access token.
 */
export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(OSU_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.OSU_CLIENT_ID,
      client_secret: process.env.OSU_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.OSU_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`osu! token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Fetch the authenticated osu! user's profile.
 */
export async function fetchOsuMe(accessToken: string): Promise<OsuUser> {
  const res = await fetch(OSU_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`osu! /me failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as OsuUser;
  return data;
}

/**
 * Build the osu! OAuth authorization URL to redirect users to.
 */
export function buildAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.OSU_CLIENT_ID!,
    redirect_uri: process.env.OSU_REDIRECT_URI!,
    response_type: "code",
    scope: "identify",
  });
  return `https://osu.ppy.sh/oauth/authorize?${params.toString()}`;
}
