// GitHub Pages static SPA entry point.
// This file is used ONLY by vite.pages.config.ts (build:pages).
// It does NOT affect the existing Lovable / TanStack Start build (vite.config.ts).

import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

// Reuse the shared createRouter factory with only basepath differing for GitHub Pages.
const router = getRouter(import.meta.env.BASE_URL);

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
