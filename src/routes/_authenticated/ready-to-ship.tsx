import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/ready-to-ship")({
  head: () => ({
    meta: [
      { title: "Ready to pick/ship — SOS Inventory" },
      { name: "description", content: "Lines ready to fulfill in SOS Inventory." },
      { property: "og:title", content: "Ready to pick/ship — SOS Inventory" },
      { property: "og:description", content: "Lines ready to fulfill in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Ready to pick/ship" subtitle="Lines ready to fulfill" />,
});
