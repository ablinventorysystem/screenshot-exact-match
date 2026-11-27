import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, Plus, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso, todayISO } from "@/lib/format";
import { roundQty } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { PurchaseOrderForm as SharedPurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { writeAuditLog } from "@/lib/txn-lookups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PoRow {
  id: string;
  ref_no: string;
  txn_date: string;
  due_date: string | null;
  party_name: string | null;
  status: string;
  voided: boolean;
  drop_ship: boolean;
  total: number;
}

interface PoLine {
  id?: string;
  item_id: string;
  description: string;
  qty: number;
  qty_received: number;
  uom: string;
  rate: number;
  amount: number;
}

export const Route = createFileRoute("/_authenticated/purchase-orders")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
    isNew: s["new"] === "1" || s["new"] === true,
  }),
  head: () => ({
    meta: [
      { title: "Purchase orders — ABL Inventory" },
      { name: "description", content: "Purchase orders from scratch or linked to sales orders." },
    ],
  }),
  component: PurchaseOrdersPage,
});

function PurchaseOrdersPage() {
  const { id, isNew } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();

  if (id || isNew) {
    return (
      <SharedPurchaseOrderForm
        poId={id}
        onClose={() => void navigate({ search: { id: undefined, isNew: false } })}
        onSaved={(savedId) => void navigate({ search: { id: savedId, isNew: false } })}
      />
    );
  }

  const qc = useQueryClient();

  const batchUpdate = async (rows: PoRow[], patch: Record<string, unknown>, actionName: string) => {
    if (!companyId || rows.length === 0) return;
    let count = 0;
    for (const r of rows) {
      const { error } = await supabase.from("transactions").update(patch as any).eq("id", r.id);
      if (!error) {
        count++;
        await writeAuditLog(companyId, actionName, "purchase_order", r.id, patch);
      }
    }
    toast.success(`${count} updated`);
    await qc.invalidateQueries({ queryKey: ["purchase_orders", companyId] });
  };

  const batchApprove = async (rows: PoRow[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    await batchUpdate(
      rows,
      { approved: true, approved_by: user?.id ?? null, approved_at: new Date().toISOString() },
      "approve",
    );
  };

  const batchDelete = async (rows: PoRow[]) => {
    const eligible = rows.filter((r: any) => !r.approved && r.status !== "received" && r.status !== "partially_received");
    if (eligible.length === 0) {
      toast.error("Only unapproved POs with no receipts can be deleted");
      return;
    }
    if (!window.confirm(`Delete ${eligible.length} purchase order(s)?`)) return;
    await batchUpdate(eligible, { voided: true, status: "void" }, "delete");
  };

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, due_date, party_name, status, voided, drop_ship, total, approved, archived, closed, vendor_confirmed, comment", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "purchase_order");
    if (a.filter === "open") q = q.in("status", ["open", "partially_received"]).eq("voided", false);
    else if (a.filter === "received") q = q.eq("status", "received");
    else if (a.filter === "voided") q = q.eq("voided", true);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);
    const sortMap: Record<string, string> = { ref: "ref_no", date: "txn_date", vendor: "party_name", total: "total" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: ((data ?? []) as unknown) as PoRow[], total: count ?? 0 };
  };

  const columns: Column<PoRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id, isNew: false } })}>
            {r.ref_no}
          </button>
          <span className={`inline-flex items-center gap-1 text-[10px] ${r.status === "received" ? "text-emerald-600" : "text-muted-foreground"}`}>
            <PackageCheck className="h-3 w-3" />
            {r.status === "received" ? "Received" : "Pending"}
          </span>
        </div>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    {
      key: "approved",
      header: "Approved",
      cell: (r: any) => (r.approved ? "Yes" : "No"),
      csv: (r: any) => (r.approved ? "Yes" : "No"),
    },
    { key: "vendor", header: "Vendor", sortable: true, cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    { key: "terms", header: "Terms", cell: () => "Net 30", csv: () => "Net 30" },
    {
      key: "total",
      header: "Amount",
      sortable: true,
      cell: (r) => <div className="text-right font-medium">₱{peso(r.total)}</div>,
      csv: (r) => String(r.total),
    },
    {
      key: "status",
      header: "Status",
      cell: (r: any) => (
        <Badge variant={r.voided ? "destructive" : r.closed || r.status === "closed" ? "secondary" : "outline"}>
          {r.voided ? "Voided" : r.closed || r.status === "closed" ? "Closed" : "Open"}
        </Badge>
      ),
      csv: (r) => r.status,
    },
    {
      key: "received",
      header: "Received",
      cell: (r) => (r.status === "received" ? "All" : r.status === "partially_received" ? "Partial" : "—"),
      csv: (r) => (r.status === "received" ? "All" : r.status === "partially_received" ? "Partial" : ""),
    },
    {
      key: "comment",
      header: "Comment",
      cell: (r: any) => (
        <span className="max-w-[160px] truncate text-xs text-muted-foreground">
          {r.comment || "—"}
        </span>
      ),
      csv: (r: any) => r.comment ?? "",
    },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Purchase orders" subtitle="showing archived and unarchived open and closed purchase orders" />
      {companyId && (
        <DataTable<PoRow>
          id="purchase_orders"
          queryKey={["purchase_orders", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "received", label: "Received" },
            { value: "voided", label: "Voided" },
          ]}
          rowActions={[
            { label: "Open PO", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id, isNew: false } }) },
            { label: "Approve", onSelect: (rows) => void batchApprove(rows) },
            { label: "Archive", onSelect: (rows) => void batchUpdate(rows, { archived: true }, "archive") },
            { label: "Unarchive", onSelect: (rows) => void batchUpdate(rows, { archived: false }, "unarchive") },
            { label: "Open", onSelect: (rows) => void batchUpdate(rows, { closed: false, status: "open" }, "open") },
            { label: "Close", onSelect: (rows) => void batchUpdate(rows, { closed: true, status: "closed" }, "close") },
            { label: "Mark as confirmed", onSelect: (rows) => void batchUpdate(rows, { vendor_confirmed: true }, "confirm") },
            { label: "Mark as unconfirmed", onSelect: (rows) => void batchUpdate(rows, { vendor_confirmed: false }, "unconfirm") },
            { label: "Add to sync", onSelect: (rows) => void batchUpdate(rows, { qb_sync_status: "unsent" }, "add_to_sync") },
            { label: "Delete", onSelect: (rows) => void batchDelete(rows) },
          ]}
          {...(canWrite ? { onAdd: () => void navigate({ search: { id: undefined, isNew: true } }) } : {})}
        />
      )}
    </div>
  );
}

function PurchaseOrderForm({
  poId,
  onBack,
  onSaved,
}: {
  poId: string | undefined;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { companyId, canWrite } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [txnDate, setTxnDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [terms, setTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("open");
  const [refNo, setRefNo] = useState("New PO");
  const [lines, setLines] = useState<PoLine[]>([]);
  const [busy, setBusy] = useState(false);

  const vendorsQ = useQuery({
    queryKey: ["po_vendors", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name, terms").eq("company_id", companyId).eq("archived", false).order("name").limit(300);
      return data ?? [];
    },
  });

  const locsQ = useQuery({
    queryKey: ["po_locs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, is_default").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["po_items", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, uom, cost, decimals_allowed").eq("company_id", companyId).eq("archived", false).order("name").limit(500);
      return data ?? [];
    },
  });

  const detailQ = useQuery({
    queryKey: ["po_detail", poId],
    enabled: !!poId,
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", poId!).single();
      if (error) throw error;
      const { data: lns } = await supabase.from("transaction_lines").select("*").eq("transaction_id", poId!).order("line_no");
      return { txn, lns: lns ?? [] };
    },
  });

  useEffect(() => {
    if (!detailQ.data) return;
    const { txn, lns } = detailQ.data;
    setRefNo(txn.ref_no);
    setVendorId(txn.party_id ?? "");
    setVendorName(txn.party_name ?? "");
    setLocationId(txn.location_id ?? "");
    setTxnDate(txn.txn_date);
    setDueDate(txn.due_date ?? "");
    setTerms(txn.terms ?? "Net 30");
    setNotes(txn.notes ?? "");
    setStatus(txn.status);
    setLines(
      lns.map((l) => ({
        id: l.id,
        item_id: l.item_id ?? "",
        description: l.description ?? "",
        qty: Number(l.qty),
        qty_received: Number(l.qty_received ?? 0),
        uom: l.uom ?? "pc",
        rate: Number(l.rate),
        amount: Number(l.amount),
      })),
    );
  }, [detailQ.data]);

  useEffect(() => {
    if (!poId && !locationId && locsQ.data?.length) {
      const def = locsQ.data.find((l) => l.is_default) ?? locsQ.data[0];
      if (def) setLocationId(def.id);
    }
  }, [poId, locationId, locsQ.data]);

  const addLine = (itemId: string) => {
    const it = (itemsQ.data ?? []).find((x) => x.id === itemId);
    if (!it) return;
    const rate = Number(it.cost ?? 0);
    setLines((prev) => [
      ...prev,
      { item_id: it.id, description: `${it.sku} — ${it.name}`, qty: 1, qty_received: 0, uom: it.uom, rate, amount: rate },
    ]);
  };

  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  const handleSave = async () => {
    if (!vendorId) return void toast.error("Select a vendor");
    if (lines.length === 0) return void toast.error("Add at least one line item");
    setBusy(true);
    try {
      const { data: savedId, error } = await supabase.rpc("save_transaction", {
        p: {
          id: poId ?? null,
          company_id: companyId,
          type: "purchase_order",
          status,
          txn_date: txnDate,
          due_date: dueDate || null,
          party_type: "vendor",
          party_id: vendorId,
          party_name: vendorName,
          location_id: locationId || null,
          terms,
          notes,
          total,
          amount_due: total,
          lines: lines.map((l) => ({
            item_id: l.item_id,
            description: l.description,
            qty: l.qty,
            qty_received: l.qty_received,
            uom: l.uom,
            rate: l.rate,
            amount: roundQty(l.qty * l.rate, 2),
            source_line_id: (l as { source_line_id?: string | null }).source_line_id ?? null,
          })),
        },
      });
      if (error) throw error;
      toast.success("Purchase order saved");
      qc.invalidateQueries({ queryKey: ["purchase_orders", companyId] });
      if (savedId) onSaved(savedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save PO");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Purchase Orders
        </Button>
        {poId && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/receipts", search: { poId } as never })}>
              <PackageCheck className="mr-1.5 h-4 w-4" />
              Receive Inventory
            </Button>
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/bills", search: { poId } as never })}>
              <Receipt className="mr-1.5 h-4 w-4" />
              Create Vendor Bill
            </Button>
          </div>
        )}
      </div>

      <PageHeader title={refNo} subtitle={poId ? `Status: ${labelize(status)}` : "New Purchase Order"} />

      <div className="max-w-5xl space-y-4">
        <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-5 md:grid-cols-3">
          <div>
            <Label htmlFor="po-vendor">Vendor *</Label>
            <select
              id="po-vendor"
              value={vendorId}
              onChange={(e) => {
                const v = (vendorsQ.data ?? []).find((x) => x.id === e.target.value);
                setVendorId(e.target.value);
                setVendorName(v?.name ?? "");
                if (v?.terms) setTerms(v.terms);
              }}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">Select vendor…</option>
              {(vendorsQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="po-loc">Receiving Location</Label>
            <select
              id="po-loc"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">Select location…</option>
              {(locsQ.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="po-terms">Terms</Label>
            <Input id="po-terms" value={terms} onChange={(e) => setTerms(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="po-date">Order Date</Label>
            <Input id="po-date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="po-due">Expected Delivery Date</Label>
            <Input id="po-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="po-notes">Notes</Label>
            <Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-md" />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-label">Line Items</h2>
            <select
              aria-label="Add item to PO"
              value=""
              onChange={(e) => {
                if (e.target.value) addLine(e.target.value);
              }}
              className="h-9 rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">+ Add item…</option>
              {(itemsQ.data ?? []).map((it) => (
                <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Received</th>
                  <th className="py-2 pr-3">UOM</th>
                  <th className="py-2 pr-3 text-right">Unit Cost</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">No lines yet. Pick an item above to add.</td>
                  </tr>
                )}
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-1.5 pr-3">{l.description}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={l.qty}
                        onChange={(e) => {
                          const q = Number(e.target.value) || 0;
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: q, amount: q * x.rate } : x)));
                        }}
                        className="ml-auto h-8 w-24 rounded-md text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground">{num(l.qty_received, 2)}</td>
                    <td className="py-1.5 pr-3">{l.uom}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={l.rate}
                        onChange={(e) => {
                          const r = Number(e.target.value) || 0;
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, rate: r, amount: x.qty * r } : x)));
                        }}
                        className="ml-auto h-8 w-28 rounded-md text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">₱{peso(l.qty * l.rate)}</td>
                    <td className="py-1.5 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove line">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <div className="text-lg font-medium">Total: ₱{peso(total)}</div>
            {canWrite && (
              <Button disabled={busy} onClick={() => void handleSave()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Save Purchase Order
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
