import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({
    meta: [
      { title: "Jobs — SOS Inventory" },
      { name: "description", content: "Production jobs in SOS Inventory." },
      { property: "og:title", content: "Jobs — SOS Inventory" },
      { property: "og:description", content: "Production jobs in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Jobs" subtitle="Production jobs" />,
});
