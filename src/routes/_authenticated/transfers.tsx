import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/transfers")({
  head: () => ({
    meta: [
      { title: "Transfers — SOS Inventory" },
      { name: "description", content: "Stock transfers in SOS Inventory." },
      { property: "og:title", content: "Transfers — SOS Inventory" },
      { property: "og:description", content: "Stock transfers in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Transfers" subtitle="Stock transfers" />,
});
