---
cand: E1
reopens: F-057
feature: hub
kind: security
severity: medium
confidence: verified
status: proposed
---

# An attacker-chosen handoff id can redeem a phished login

## Problem

`GET /auth/login` copies `handoff` and `challenge` from the query into OAuth state. `createHandoff` reuses that id when it is 16–128 url-safe characters and unused. The callback stores the victim's JWT under it, bound to the attacker's challenge.

The verifier stops someone who only learned the id. It does not stop the sender of the link, who chose the challenge. They call `POST /auth/handoff/:id` with their own verifier.

`client=desktop` is not required. A web login accepts an optional `handoff` too. The legitimate desktop client does generate the id locally (`beginHubOAuthHandoff`). Hub never checks that this process issued it.

The desktop redirect is `http://127.0.0.1:4321/api/system/hub-oauth/complete`. A remote attacker does not see that response. The web redirect is the app origin, not the attacker's origin. The hole is that the attacker already knows the id because they put it in the link.

## Potential solution

Hub always generates the handoff id. Stop reading `query.handoff` as a storage key. `createHandoff` always uses `randomId()`. Delete the `preferredId` branch.

Desktop still has to bind the redirect to the pending login on localhost, or `/complete` will 400 on an id it did not create. Pass a local nonce, not the redeem id.

1. `beginHubOAuthHandoff` keeps generating the local id, verifier, and challenge. The local id is a nonce. It is not the Hub handoff id.
2. Login URL: `client=desktop&nonce=<local id>&challenge=<challenge>`. No `handoff` param. Web login stays challenge-only, as `hubLoginUrl` already does when `client` is omitted.
3. OAuth state stores `nonce` instead of `handoffId`. Desktop login requires a nonce of the same shape as today's handoff id. Web login does not.
4. After the code exchange, Hub creates the handoff with `randomId()` and the challenge from state (the legitimate client's challenge, which the attacker no longer chooses unless they also started the local login).
5. Desktop redirect: `/complete?h=<hub id>&n=<nonce>`. `markHubOAuthHandoffReady` looks up the nonce, stores the Hub id on that pending row, and marks it ready. An unknown nonce is the existing 400.
6. `/hub-oauth/pending` still takes the local id and the verifier. It redeems `pending.hubHandoffId`, not the local id.

A phished link now carries the attacker's nonce and challenge. The victim's localhost has no such nonce, so `/complete` does not bind the login. The Hub id is only on the redirect to `127.0.0.1`, which the attacker does not see. Their challenge is useless without that id.

Web: the id appears only in the redirect to `HUB_CLIENT_REDIRECT_URI` (default `http://127.0.0.1:4321/#/hub-callback`). The victim's page redeems it with the verifier it stored before navigation. An attacker-supplied `handoff` query param is ignored, so the old web fixation dies with the same change.

## Do not

- Do not keep `preferredId` behind a comment that desktop is trusted. The next caller will pass the query string back in.
- Do not put the verifier in the redirect. It stays in the initiating UI, as the current comments say.
- Do not make the desktop redirect host configurable from the login query. `HUB_DESKTOP_REDIRECT_URI` is server env. Leave it that way.

## Touch

- `apps/hub/src/routes/auth.ts` — login query, both redirects
- `apps/hub/src/services/oauthState.ts` — state field, `createHandoff`
- `apps/server/src/hubOAuthPending.ts` — store `hubHandoffId` on ready
- `apps/server/src/routes/system.ts` — `/complete` reads `n` and `h`; `/pending` redeems the stored Hub id
- `apps/server/public/lib/hub.ts` — `hubLoginUrl` sends `nonce`, not `handoff`
- `apps/server/public/features/hub/HubLoginButton.tsx` — desktop URL uses the begin id as nonce

## Tests

- Login with `handoff` and `challenge` chosen by the test, then the OAuth callback: the stored handoff id is not the query id. `POST /auth/handoff/<query id>` is 404.
- Desktop: begin, login with that nonce, callback, `/complete?h=<hub id>&n=<nonce>` marks ready, `/pending` redeems `<hub id>`.
- `/complete` with a nonce that was not begun is 400 and does not store the Hub id.
