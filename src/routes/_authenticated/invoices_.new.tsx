import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InvoiceForm } from "@/components/InvoiceForm";

export const Route = createFileRoute("/_authenticated/invoices_/new")({
  head: () => ({
    meta: [{ title: "New Invoice — ABL Inventory" }],
  }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const navigate = useNavigate();
  return (
    <InvoiceForm
      onClose={() => void navigate({ to: "/invoices", search: { id: undefined, isNew: false, fromSo: undefined } })}
      onSaved={(id) => void navigate({ to: "/invoices", search: { id, isNew: false, fromSo: undefined } })}
    />
  );
}
