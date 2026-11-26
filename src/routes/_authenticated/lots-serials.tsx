import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/lots-serials")({
  head: () => ({
    meta: [
      { title: "Lots/Serials — SOS Inventory" },
      { name: "description", content: "Lot and serial tracking in SOS Inventory." },
      { property: "og:title", content: "Lots/Serials — SOS Inventory" },
      { property: "og:description", content: "Lot and serial tracking in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Lots/Serials" subtitle="Lot and serial tracking" />,
});
