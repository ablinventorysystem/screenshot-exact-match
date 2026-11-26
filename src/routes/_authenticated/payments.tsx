import { createFileRoute } from "@tanstack/react-router";
import { SalesDocList } from "@/components/SalesDocList";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — SOS Inventory" },
      { name: "description", content: "Customer payments and EWT withholding records." },
    ],
  }),
  component: () => (
    <SalesDocList
      type="payment"
      title="Payments"
      subtitle="Customer payments and Form 2307 withholding credits"
    />
  ),
});
