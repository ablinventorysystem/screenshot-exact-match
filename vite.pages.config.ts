// GitHub Pages static SPA Vite config.
// Used by: npm run build:pages
// Output:  dist/
// Does NOT affect the existing Lovable build (vite.config.ts → .output/).

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

export default defineConfig({
  // Must match the GitHub Pages repository subpath exactly.
  base: "/screenshot-exact-match/",

  // Explicitly inline Supabase public config into import.meta.env for static SPA builds
  // whether provided as VITE_SUPABASE_* or SUPABASE_* in CI.
  define: {
    ...(supabaseUrl
      ? { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl) }
      : {}),
    ...(supabasePublishableKey
      ? {
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
            supabasePublishableKey,
          ),
        }
      : {}),
  },

  plugins: [
    // Router plugin: auto code-splitting for TanStack routes.
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],

  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Standard SPA — single entry point; no SSR.
    rollupOptions: {
      input: "index.html",
    },
  },

  // Point Vite at the SPA index.html (not the TanStack Start SSR entry).
  // The file is in the project root, which is also Vite's root.
  root: ".",
});
