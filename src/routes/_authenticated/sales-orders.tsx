import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/sales-orders")({
  head: () => ({
    meta: [
      { title: "Sales orders — SOS Inventory" },
      { name: "description", content: "Customer orders in SOS Inventory." },
      { property: "og:title", content: "Sales orders — SOS Inventory" },
      { property: "og:description", content: "Customer orders in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Sales orders" subtitle="Customer orders" />,
});
