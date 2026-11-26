import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/builds")({
  head: () => ({
    meta: [
      { title: "Builds — SOS Inventory" },
      { name: "description", content: "Assembly builds in SOS Inventory." },
      { property: "og:title", content: "Builds — SOS Inventory" },
      { property: "og:description", content: "Assembly builds in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Builds" subtitle="Assembly builds" />,
});
