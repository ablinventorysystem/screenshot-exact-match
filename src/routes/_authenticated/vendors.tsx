import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/vendors")({
  head: () => ({
    meta: [
      { title: "Vendors — SOS Inventory" },
      { name: "description", content: "Supplier list in SOS Inventory." },
      { property: "og:title", content: "Vendors — SOS Inventory" },
      { property: "og:description", content: "Supplier list in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Vendors" subtitle="Supplier list" />,
});
