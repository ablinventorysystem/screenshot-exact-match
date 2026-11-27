// GitHub Pages static SPA entry point.
// This file is used ONLY by vite.pages.config.ts (build:pages).
// It does NOT affect the existing Lovable / TanStack Start build (vite.config.ts).

import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data fresh for 5 minutes; prevents aggressive re-fetching on every
      // mount/focus/router.invalidate() that staleTime:0 would cause.
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

// basepath is set to BASE_URL by vite.pages.config.ts → "/screenshot-exact-match/"
const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  scrollRestoration: true,
  // defaultPreloadStaleTime:0 means preloaded data is always considered stale and
  // refetched immediately — combine with staleTime above for predictable caching.
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// __root.tsx's RootComponent wraps in <QueryClientProvider>; no extra wrapper needed here.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
