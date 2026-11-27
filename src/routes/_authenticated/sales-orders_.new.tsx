import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SalesOrderForm } from "@/routes/_authenticated/sales-orders";

export const Route = createFileRoute("/_authenticated/sales-orders_/new")({
  head: () => ({
    meta: [{ title: "New Sales Order — ABL Inventory" }],
  }),
  component: NewSalesOrderPage,
});

function NewSalesOrderPage() {
  const navigate = useNavigate();
  return (
    <SalesOrderForm
      onBack={() => void navigate({ to: "/sales-orders", search: { id: undefined, isNew: false } })}
      onSavedId={(id) => void navigate({ to: "/sales-orders", search: { id, isNew: false } })}
    />
  );
}
