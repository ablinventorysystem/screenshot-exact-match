import { createFileRoute } from "@tanstack/react-router";
import { SalesDocList } from "@/components/SalesDocList";

export const Route = createFileRoute("/_authenticated/pick-tickets")({
  head: () => ({
    meta: [
      { title: "Pick tickets — SOS Inventory" },
      { name: "description", content: "Warehouse pick tickets with FEFO lot suggestions." },
    ],
  }),
  component: () => (
    <SalesDocList
      type="pick_ticket"
      title="Pick tickets"
      subtitle="Warehouse pick lists grouped by location with FEFO suggestions"
      printable
    />
  ),
});
