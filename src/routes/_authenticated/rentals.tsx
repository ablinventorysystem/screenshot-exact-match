import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/rentals")({
  head: () => ({
    meta: [
      { title: "Rentals — SOS Inventory" },
      { name: "description", content: "Rental items in SOS Inventory." },
      { property: "og:title", content: "Rentals — SOS Inventory" },
      { property: "og:description", content: "Rental items in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Rentals" subtitle="Rental items" />,
});
