import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";

export const Route = createFileRoute("/_authenticated/purchase-orders_/new")({
  head: () => ({
    meta: [{ title: "New Purchase Order — ABL Inventory" }],
  }),
  component: NewPurchaseOrderPage,
});

function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  return (
    <PurchaseOrderForm
      onClose={() => void navigate({ to: "/purchase-orders", search: { id: undefined, isNew: false } })}
      onSaved={(id) => void navigate({ to: "/purchase-orders", search: { id, isNew: false } })}
    />
  );
}
