import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
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

export function App() {
  useEffect(() => connectLiveUpdates(queryClient), []);
  useEffect(() => connectSyncFocus(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
