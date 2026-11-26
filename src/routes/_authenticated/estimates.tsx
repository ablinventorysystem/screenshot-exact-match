import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";

interface EstRow {
  id: string;
  ref_no: string;
  txn_date: string;
  party_id: string | null;
  party_name: string | null;
  location_id: string | null;
  status: string;
  total: number;
  notes: string | null;
}

export const Route = createFileRoute("/_authenticated/estimates")({
  head: () => ({
    meta: [
      { title: "Estimates — ABL Inventory" },
      { name: "description", content: "Customer quotes and estimates with one-click conversion to Sales Orders." },
    ],
  }),
  component: EstimatesPage,
});

function EstimatesPage() {
  const { companyId, canWrite } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_id, party_name, location_id, status, total, notes", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "estimate");
    if (a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as EstRow[], total: count ?? 0 };
  };

  const convertToSalesOrder = async (rows: EstRow[]) => {
    const est = rows[0];
    if (!est || !canWrite) return;
    const { data: lines } = await supabase.from("transaction_lines").select("*").eq("transaction_id", est.id);
    const { data: soId, error } = await supabase.rpc("save_transaction", {
      p: {
        company_id: companyId,
        type: "sales_order",
        status: "open",
        txn_date: todayISO(),
        party_type: "customer",
        party_id: est.party_id,
        party_name: est.party_name,
        location_id: est.location_id,
        parent_txn_id: est.id,
        total: est.total,
        amount_due: est.total,
        notes: `Converted from ${est.ref_no}`,
        lines: (lines ?? []).map((l) => ({
          item_id: l.item_id,
          description: l.description,
          qty: l.qty,
          rate: l.rate,
          amount: l.amount,
          tax_code_id: l.tax_code_id,
          vat_amount: l.vat_amount,
        })),
      },
    });
    if (error) return void toast.error(error.message);
    await supabase.from("transactions").update({ status: "accepted" }).eq("id", est.id);
    toast.success("Converted Estimate to Sales Order");
    qc.invalidateQueries({ queryKey: ["estimates", companyId] });
    void navigate({ to: "/sales-orders", search: { id: soId, isNew: false } });
  };

  const columns: Column<EstRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    { key: "status", header: "Status", cell: (r) => <Badge variant="outline">{labelize(r.status)}</Badge>, csv: (r) => r.status },
    { key: "total", header: "Total", cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
    {
      key: "convert",
      header: "Convert",
      cell: (r) =>
        canWrite && r.status !== "closed" ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void convertToSalesOrder([r])}>
            Convert to SO
          </Button>
        ) : null,
      csv: () => "",
    },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Estimates" subtitle="Customer quotations and proposals" />
      {companyId && (
        <DataTable<EstRow>
          id="estimates"
          queryKey={["estimates", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "accepted", label: "Accepted" },
            { value: "closed", label: "Closed" },
          ]}
          {...(canWrite
            ? {
                rowActions: [{ label: "Convert to Sales Order", onSelect: convertToSalesOrder }],
                onAdd: () => setCreateOpen(true),
              }
            : {})}
        />
      )}
      <CreateEstimateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["estimates", companyId] })}
      />
    </div>
  );
}

function CreateEstimateDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { companyId } = useCompany();
  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const custQ = useQuery({
    queryKey: ["est_custs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, name").eq("company_id", companyId).eq("archived", false).order("name").limit(200);
      return data ?? [];
    },
  });

  const itemQ = useQuery({
    queryKey: ["est_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, price").eq("company_id", companyId).eq("archived", false).order("sku").limit(200);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = (custQ.data ?? []).find((c) => c.id === customerId);
    const it = (itemQ.data ?? []).find((i) => i.id === itemId);
    if (!cust || !it) return void toast.error("Customer and item are required");
    setBusy(true);
    try {
      const qVal = Number(qty) || 1;
      const amt = qVal * Number(it.price);
      const { error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "estimate",
          status: "pending",
          txn_date: todayISO(),
          party_type: "customer",
          party_id: cust.id,
          party_name: cust.name,
          total: amt,
          amount_due: amt,
          lines: [{ item_id: it.id, description: it.name, qty: qVal, rate: it.price, amount: amt }],
        },
      });
      if (error) throw error;
      toast.success("Estimate created");
      setCustomerId("");
      setItemId("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create estimate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>New Estimate</SheetTitle></SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="est-c">Customer *</Label>
            <select id="est-c" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select customer…</option>
              {(custQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="est-i">Item *</Label>
            <select id="est-i" value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select item…</option>
              {(itemQ.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="est-q">Qty</Label>
            <Input id="est-q" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create Estimate</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
