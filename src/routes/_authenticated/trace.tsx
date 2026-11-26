import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/trace")({
  head: () => ({
    meta: [
      { title: "Trace — SOS Inventory" },
      { name: "description", content: "Lot and serial trace in SOS Inventory." },
      { property: "og:title", content: "Trace — SOS Inventory" },
      { property: "og:description", content: "Lot and serial trace in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Trace" subtitle="Lot and serial trace" />,
});
