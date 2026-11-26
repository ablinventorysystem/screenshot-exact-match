import { createFileRoute } from "@tanstack/react-router";
import { SalesDocList } from "@/components/SalesDocList";

export const Route = createFileRoute("/_authenticated/returns")({
  head: () => ({
    meta: [
      { title: "Returns — SOS Inventory" },
      { name: "description", content: "Customer returns and credit memos." },
    ],
  }),
  component: () => (
    <SalesDocList
      type="return"
      title="Returns"
      subtitle="Customer returns, restocking, and credit memos"
    />
  ),
});
