import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — SOS Inventory" },
      { name: "description", content: "Business reports in SOS Inventory." },
      { property: "og:title", content: "Reports — SOS Inventory" },
      { property: "og:description", content: "Business reports in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Reports" subtitle="Business reports" />,
});
