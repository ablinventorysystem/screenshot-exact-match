import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/processes")({
  head: () => ({
    meta: [
      { title: "Processes — SOS Inventory" },
      { name: "description", content: "Production processes in SOS Inventory." },
      { property: "og:title", content: "Processes — SOS Inventory" },
      { property: "og:description", content: "Production processes in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Processes" subtitle="Production processes" />,
});
