import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/estimates")({
  head: () => ({
    meta: [
      { title: "Estimates — SOS Inventory" },
      { name: "description", content: "Quotes to customers in SOS Inventory." },
      { property: "og:title", content: "Estimates — SOS Inventory" },
      { property: "og:description", content: "Quotes to customers in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Estimates" subtitle="Quotes to customers" />,
});
