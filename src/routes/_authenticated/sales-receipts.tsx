import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/sales-receipts")({
  head: () => ({
    meta: [
      { title: "Sales receipts — SOS Inventory" },
      { name: "description", content: "Cash sales in SOS Inventory." },
      { property: "og:title", content: "Sales receipts — SOS Inventory" },
      { property: "og:description", content: "Cash sales in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Sales receipts" subtitle="Cash sales" />,
});
