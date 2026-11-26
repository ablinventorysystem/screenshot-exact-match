import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/locations")({
  head: () => ({
    meta: [
      { title: "Locations — SOS Inventory" },
      { name: "description", content: "Warehouses and stores in SOS Inventory." },
      { property: "og:title", content: "Locations — SOS Inventory" },
      { property: "og:description", content: "Warehouses and stores in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Locations" subtitle="Warehouses and stores" />,
});
