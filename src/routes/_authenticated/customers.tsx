import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — SOS Inventory" },
      { name: "description", content: "Customer list in SOS Inventory." },
      { property: "og:title", content: "Customers — SOS Inventory" },
      { property: "og:description", content: "Customer list in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Customers" subtitle="Customer list" />,
});
