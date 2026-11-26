import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/rmas")({
  head: () => ({
    meta: [
      { title: "RMAs — SOS Inventory" },
      { name: "description", content: "Return authorizations in SOS Inventory." },
      { property: "og:title", content: "RMAs — SOS Inventory" },
      { property: "og:description", content: "Return authorizations in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="RMAs" subtitle="Return authorizations" />,
});
