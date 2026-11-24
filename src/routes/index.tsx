import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SOS Inventory — Dashboard" },
      { name: "description", content: "Inventory and order management for Philippine businesses." },
      { property: "og:title", content: "SOS Inventory — Dashboard" },
      { property: "og:description", content: "Inventory and order management for Philippine businesses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
