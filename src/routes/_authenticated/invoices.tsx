import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — SOS Inventory" },
      { name: "description", content: "BIR sales invoices in SOS Inventory." },
      { property: "og:title", content: "Invoices — SOS Inventory" },
      { property: "og:description", content: "BIR sales invoices in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Invoices" subtitle="BIR sales invoices" />,
});
