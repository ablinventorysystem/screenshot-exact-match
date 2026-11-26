import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/adjustments")({
  head: () => ({
    meta: [
      { title: "Adjustments — SOS Inventory" },
      { name: "description", content: "Inventory adjustments in SOS Inventory." },
      { property: "og:title", content: "Adjustments — SOS Inventory" },
      { property: "og:description", content: "Inventory adjustments in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Adjustments" subtitle="Inventory adjustments" />,
});
