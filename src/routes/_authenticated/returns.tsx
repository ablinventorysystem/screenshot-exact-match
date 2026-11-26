import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/returns")({
  head: () => ({
    meta: [
      { title: "Returns — SOS Inventory" },
      { name: "description", content: "Customer returns in SOS Inventory." },
      { property: "og:title", content: "Returns — SOS Inventory" },
      { property: "og:description", content: "Customer returns in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Returns" subtitle="Customer returns" />,
});
