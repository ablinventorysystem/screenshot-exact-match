import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — SOS Inventory" },
      { name: "description", content: "Customer payments in SOS Inventory." },
      { property: "og:title", content: "Payments — SOS Inventory" },
      { property: "og:description", content: "Customer payments in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Payments" subtitle="Customer payments" />,
});
