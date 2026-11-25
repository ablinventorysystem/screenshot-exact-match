import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SOS Inventory" },
      { name: "description", content: "Sync, sales and tax overview." },
      { property: "og:title", content: "Dashboard — SOS Inventory" },
      { property: "og:description", content: "Sync, sales and tax overview." },
    ],
  }),
  component: () => (
    <div className="p-6">
      <h1 className="page-title">Dashboard</h1>
      <p className="text-muted-foreground">Coming next</p>
    </div>
  ),
});
