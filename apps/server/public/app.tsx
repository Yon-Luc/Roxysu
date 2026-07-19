import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { fetchSettings } from "./lib/api";
import { connectLiveUpdates } from "./lib/sse";
import { connectSyncFocus } from "./lib/syncFocus";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
});

function SyncFocusBridge() {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });
  const enabled = data?.sync?.pauseWhenUnfocused ?? false;

  useEffect(() => connectSyncFocus(enabled), [enabled]);

  return null;
}

export function App() {
  useEffect(() => connectLiveUpdates(queryClient), []);

  return (
    <QueryClientProvider client={queryClient}>
      <SyncFocusBridge />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
