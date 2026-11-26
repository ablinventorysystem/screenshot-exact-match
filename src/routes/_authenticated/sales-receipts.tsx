import { createFileRoute } from "@tanstack/react-router";
import { SalesDocList } from "@/components/SalesDocList";

export const Route = createFileRoute("/_authenticated/sales-receipts")({
  head: () => ({
    meta: [
      { title: "Sales receipts — ABL Inventory" },
      { name: "description", content: "Cash and POS sales receipts." },
    ],
  }),
  component: () => (
    <SalesDocList
      type="sales_receipt"
      title="Sales receipts"
      subtitle="Immediate cash and POS sales receipts"
      printable
    />
  ),
});
