import { createFileRoute } from "@tanstack/react-router";
import { SalesDocList } from "@/components/SalesDocList";

export const Route = createFileRoute("/_authenticated/rmas")({
  head: () => ({
    meta: [
      { title: "RMAs — SOS Inventory" },
      { name: "description", content: "Return Merchandise Authorizations." },
    ],
  }),
  component: () => (
    <SalesDocList
      type="rma"
      title="RMAs"
      subtitle="Return Merchandise Authorizations"
    />
  ),
});
