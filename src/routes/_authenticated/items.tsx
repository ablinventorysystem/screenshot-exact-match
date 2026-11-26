import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/items")({
  head: () => ({
    meta: [
      { title: "Items — SOS Inventory" },
      { name: "description", content: "Inventory items in SOS Inventory." },
      { property: "og:title", content: "Items — SOS Inventory" },
      { property: "og:description", content: "Inventory items in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Items" subtitle="Inventory items" />,
});
