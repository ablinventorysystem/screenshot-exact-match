import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/pick-tickets")({
  head: () => ({
    meta: [
      { title: "Pick tickets — SOS Inventory" },
      { name: "description", content: "Warehouse picking in SOS Inventory." },
      { property: "og:title", content: "Pick tickets — SOS Inventory" },
      { property: "og:description", content: "Warehouse picking in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Pick tickets" subtitle="Warehouse picking" />,
});
