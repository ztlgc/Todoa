import { QueryClient } from "@tanstack/react-query";

export function createLocalQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: 1,
        retryDelay: 250,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: "always",
        retry: 0,
      },
    },
  });
}
