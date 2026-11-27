// GitHub Pages static SPA Vite config.
// Used by: npm run build:pages
// Output:  dist/
// Does NOT affect the existing Lovable build (vite.config.ts → .output/).

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const supabasePublishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";
  const basePath =
    env.VITE_BASE_PATH || process.env.VITE_BASE_PATH || "/screenshot-exact-match/";

  return {
    // Must match the GitHub Pages repository subpath exactly.
    base: basePath,

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
      // Ensure bracket-notation import.meta.env['VITE_SUPABASE_*'] in generated client.ts
      // is replaced at build time even when .env is absent (e.g. GitHub Actions).
      {
        name: "inject-supabase-env",
        enforce: "pre",
        transform(code, id) {
          if (id.replace(/\\/g, "/").endsWith("src/integrations/supabase/client.ts")) {
            let out = code;
            if (supabaseUrl) {
              out = out.replace(
                /import\.meta\.env\['VITE_SUPABASE_URL'\]/g,
                JSON.stringify(supabaseUrl),
              );
            }
            if (supabasePublishableKey) {
              out = out.replace(
                /import\.meta\.env\['VITE_SUPABASE_PUBLISHABLE_KEY'\]/g,
                JSON.stringify(supabasePublishableKey),
              );
            }
            return out;
          }
        },
      },
      // Router plugin: auto code-splitting for TanStack routes.
      TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],

    resolve: {
      tsconfigPaths: true,
    },

    build: {
      outDir: "dist",
      emptyOutDir: true,
      minify: true,
      // Standard SPA — single entry point; no SSR.
      rollupOptions: {
        input: "index.html",
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("/react-dom/") || id.includes("/react/")) return "vendor-react";
            if (id.includes("/@supabase/")) return "vendor-supabase";
            if (id.includes("/@tanstack/")) return "vendor-router";
            if (id.includes("/@radix-ui/") || id.includes("/lucide-react/") || id.includes("/sonner/")) {
              return "vendor-ui";
            }
          },
        },
      },
    },

    // Point Vite at the SPA index.html (not the TanStack Start SSR entry).
    // The file is in the project root, which is also Vite's root.
    root: ".",
  };
});
