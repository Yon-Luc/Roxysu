---
cand: G6
reopens: F-057
feature: hub
kind: correctness
severity: low
confidence: verified
status: proposed
---

# Hub callback redeems against the default Hub URL first

## Problem

`useHubUrl` returns `http://localhost:4322` until the system-status query resolves. The OAuth return is a full page load, so that cache is empty. `HubCallbackPage` redeems in an effect that depends on `hubUrl` and `dict`, with no `isFetched` check and no once-only ref.

`redeemHubHandoff` POSTs the handoff id and the sessionStorage verifier. On desktop, `resolveHubBaseUrl()` is `https://roxysu-api.yonx.app` unless `HUB_URL` is set, so the first run posts that secret to whatever is listening on `localhost:4322`. The effect runs again when status resolves. The page flashes an error until navigation.

In dev, where Hub really is `:4322`, the first URL is not wrong. A second run still happens if `dict` changes. The verifier is one-time, so the second POST can 404 after the first redeem succeeded, and the catch shows "Sign-in failed" for a login that worked.

## Potential solution

Do not redeem until the status query has resolved, and redeem once.

`useHubUrl` cannot express "not yet known" today. It always returns a string. Either return `string | null`, or have the page use the query directly.

```ts
const status = useQuery({ queryKey: ["system-status"], queryFn: fetchSystemStatus, staleTime: 60_000 });
const started = useRef(false);

useEffect(() => {
  if (!status.isSuccess || started.current) return;
  const hubUrl = status.data.hubUrl;
  if (!hubUrl) return;
  started.current = true;
  const handoff = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("h");
  // existing redeem, then navigate
}, [status.isSuccess, status.data, navigate, dict]);
```

Set the ref before the await, not after. Otherwise a `dict` change mid-flight starts a second POST.

`dict` can stay in the effect for the error string. It must not be able to re-enter the redeem. The ref is what makes that true.

Keep the localhost default for callers that only build links and can tolerate a later correction. The callback is not one of those callers. A wrong POST spends the verifier.

## Do not

- Do not redeem against the default and ignore the error. The first POST is the one that consumes the handoff when the default happens to be a live Hub.
- Do not put the verifier in the URL to "retry". It stays in sessionStorage.

## Touch

- `apps/server/public/features/hub/HubCallbackPage.tsx`
- `apps/server/public/lib/hub.ts` — only if `useHubUrl` grows a pending state other callers need. Prefer not changing the string return if the page can use the query.

## Tests

Render the page with a status query that resolves on the second tick to `https://roxysu-api.yonx.app`. The redeem spy is called once, with that origin, never with `localhost:4322`. A `dict` change after resolve does not call it again.
