import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase orders — SOS Inventory" },
      { name: "description", content: "Open and closed POs in SOS Inventory." },
      { property: "og:title", content: "Purchase orders — SOS Inventory" },
      { property: "og:description", content: "Open and closed POs in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Purchase orders" subtitle="Open and closed POs" />,
});
