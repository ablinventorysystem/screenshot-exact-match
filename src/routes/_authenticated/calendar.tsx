import { createFileRoute } from "@tanstack/react-router";
import { ComingNext } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — SOS Inventory" },
      { name: "description", content: "Schedule of transactions in SOS Inventory." },
      { property: "og:title", content: "Calendar — SOS Inventory" },
      { property: "og:description", content: "Schedule of transactions in SOS Inventory." },
    ],
  }),
  component: () => <ComingNext title="Calendar" subtitle="Schedule of transactions" />,
});
