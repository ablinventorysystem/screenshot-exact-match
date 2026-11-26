import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/work-orders")({
  head: () => ({
    meta: [
      { title: "Work orders — SOS Inventory" },
      { name: "description", content: "Production work orders in SOS Inventory." },
      { property: "og:title", content: "Work orders — SOS Inventory" },
      { property: "og:description", content: "Production work orders in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Work orders" subtitle="Production work orders" />,
});
