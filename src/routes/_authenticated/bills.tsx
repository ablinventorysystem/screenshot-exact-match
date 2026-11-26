import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/bills")({
  head: () => ({
    meta: [
      { title: "Bills — SOS Inventory" },
      { name: "description", content: "Vendor bills in SOS Inventory." },
      { property: "og:title", content: "Bills — SOS Inventory" },
      { property: "og:description", content: "Vendor bills in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Bills" subtitle="Vendor bills" />,
});
