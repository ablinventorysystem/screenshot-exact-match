import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts — SOS Inventory" },
      { name: "description", content: "Item receipts in SOS Inventory." },
      { property: "og:title", content: "Receipts — SOS Inventory" },
      { property: "og:description", content: "Item receipts in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Receipts" subtitle="Item receipts" />,
});
