import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { round2 } from "@/lib/ph-tax";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RmaRow {
  id: string;
  ref_no: string;
  txn_date: string;
  party_name: string | null;
  rma_stage: string | null;
  rma_disposition: string | null;
  return_reason: string | null;
  total: number;
}

const STAGES = ["authorized", "received", "inspected", "restocked", "scrapped", "credited", "refunded"] as const;

export const Route = createFileRoute("/_authenticated/rmas")({
  head: () => ({
    meta: [
      { title: "RMAs — SOS Inventory" },
      { name: "description", content: "Return Merchandise Authorizations: authorize, receive, inspect, restock/scrap, and BIR credit memo." },
    ],
  }),
  component: RmasPage,
});

function RmasPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_name, rma_stage, rma_disposition, return_reason, total", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "rma");
    if (a.filter !== "all") q = q.eq("rma_stage", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as RmaRow[], total: count ?? 0 };
  };

  const columns: Column<RmaRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => setActiveId(r.id)}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    {
      key: "stage",
      header: "Stage",
      cell: (r) => <Badge variant={r.rma_stage === "credited" || r.rma_stage === "refunded" ? "secondary" : "outline"}>{labelize(r.rma_stage ?? "authorized")}</Badge>,
      csv: (r) => r.rma_stage ?? "authorized",
    },
    { key: "disp", header: "Disposition", cell: (r) => labelize(r.rma_disposition ?? "—"), csv: (r) => r.rma_disposition ?? "" },
    { key: "reason", header: "Reason", cell: (r) => r.return_reason ?? "—", csv: (r) => r.return_reason ?? "" },
    { key: "total", header: "Amount", cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
  ];

  return (
    <div className="p-6">
      <PageHeader title="RMAs" subtitle="Authorize > Receive > Inspect > Restock/Scrap > BIR Credit Memo or Refund" />
      {companyId && (
        <DataTable<RmaRow>
          id="rmas"
          queryKey={["rmas", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            ...STAGES.map((s) => ({ value: s, label: labelize(s) })),
          ]}
          rowActions={[{ label: "Process RMA", onSelect: (rows) => rows[0] && setActiveId(rows[0].id) }]}
          {...(canWrite ? { onAdd: () => setCreateOpen(true) } : {})}
        />
      )}
      <CreateRmaDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["rmas", companyId] })} />
      {activeId && <RmaWorkflowDialog rmaId={activeId} onClose={() => setActiveId(null)} onDone={() => qc.invalidateQueries({ queryKey: ["rmas", companyId] })} />}
    </div>
  );
}

function CreateRmaDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { companyId } = useCompany();
  const [shipmentId, setShipmentId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [serialId, setSerialId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("Defective item");
  const [busy, setBusy] = useState(false);

  const shipsQ = useQuery({
    queryKey: ["rma_ships", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("transactions").select("id, ref_no, party_id, party_name, location_id").eq("company_id", companyId).eq("type", "shipment").order("txn_date", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const custsQ = useQuery({
    queryKey: ["rma_custs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, name").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["rma_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, price, uom").eq("company_id", companyId).eq("archived", false).limit(400);
      return data ?? [];
    },
  });

  const serialsQ = useQuery({
    queryKey: ["rma_serials", companyId, itemId],
    enabled: open && !!itemId,
    queryFn: async () => {
      const { data } = await supabase.from("item_serials").select("id, serial_no").eq("company_id", companyId).eq("item_id", itemId);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = (custsQ.data ?? []).find((c) => c.id === customerId);
    const it = (itemsQ.data ?? []).find((x) => x.id === itemId);
    if (!cust || !it) return void toast.error("Select customer and item");
    const ship = (shipsQ.data ?? []).find((s) => s.id === shipmentId);
    const q = Number(qty) || 1;
    const total = round2(q * Number(it.price));
    setBusy(true);
    try {
      const { error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "rma",
          status: "open",
          rma_stage: "authorized",
          txn_date: todayISO(),
          party_type: "customer",
          party_id: cust.id,
          party_name: cust.name,
          parent_txn_id: ship?.id || null,
          location_id: ship?.location_id || null,
          return_reason: reason.trim(),
          total,
          lines: [{ item_id: it.id, description: `${it.sku} — ${it.name}`, qty: q, uom: it.uom, rate: Number(it.price), amount: total, serial_id: serialId || null }],
        },
      });
      if (error) throw error;
      toast.success("RMA authorized");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to authorize RMA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Authorize RMA</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="rma-ship">Original Shipment (optional)</Label>
            <select
              id="rma-ship"
              value={shipmentId}
              onChange={(e) => {
                setShipmentId(e.target.value);
                const sh = (shipsQ.data ?? []).find((s) => s.id === e.target.value);
                if (sh?.party_id) setCustomerId(sh.party_id);
              }}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">None</option>
              {(shipsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.ref_no} — {s.party_name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="rma-cust">Customer *</Label>
            <select id="rma-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select customer…</option>
              {(custsQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="rma-item">Item *</Label>
            <select id="rma-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select item…</option>
              {(itemsQ.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
            </select>
          </div>
          {(serialsQ.data ?? []).length > 0 && (
            <div>
              <Label htmlFor="rma-ser">Serial #</Label>
              <select id="rma-ser" value={serialId} onChange={(e) => setSerialId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
                <option value="">None</option>
                {(serialsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.serial_no}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rma-qty">Qty</Label>
              <Input id="rma-qty" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="rma-reason">Reason</Label>
              <Input id="rma-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" />
              Authorize RMA
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RmaWorkflowDialog({ rmaId, onClose, onDone }: { rmaId: string; onClose: () => void; onDone: () => void }) {
  const { company, companyId, canWrite } = useCompany();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["rma_detail", rmaId],
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", rmaId).single();
      if (error) throw error;
      const { data: lines } = await supabase.from("transaction_lines").select("*").eq("transaction_id", rmaId);
      return { txn, lines: lines ?? [] };
    },
  });

  const advance = async (stage: string, disposition?: "restock" | "scrap", action?: "credit_memo" | "refund") => {
    if (!q.data || !company) return;
    setBusy(true);
    try {
      const { txn, lines } = q.data;
      if (disposition === "restock" || disposition === "scrap") {
        for (const l of lines) {
          if (disposition === "restock" && l.item_id && txn.location_id) {
            await adjustInventoryLevel({
              companyId,
              itemId: l.item_id,
              locationId: txn.location_id,
              lotId: l.lot_id,
              serialId: l.serial_id,
              delta: Number(l.qty),
              txnDate: todayISO(),
              txnRef: `RMA-${txn.ref_no}`,
              transactionId: rmaId,
            });
          }
          if (l.serial_id) {
            await supabase.from("item_serials").update({ status: disposition === "restock" ? "returned" : "scrapped" }).eq("id", l.serial_id);
          }
        }
      }

      let creditId: string | null = null;
      if (action === "credit_memo") {
        const gross = Number(txn.total);
        const vatRev = company.vat_registered ? round2((gross / 1.12) * 0.12) : 0;
        const vatableRev = round2(gross - vatRev);
        const { data: cmId, error: cmErr } = await supabase.rpc("save_transaction", {
          p: {
            company_id: companyId,
            type: "credit_memo",
            status: "closed",
            txn_date: todayISO(),
            party_type: "customer",
            party_id: txn.party_id,
            party_name: txn.party_name,
            parent_txn_id: rmaId,
            vatable_sales: -vatableRev,
            vat_amount: -vatRev,
            total: -gross,
            amount_due: -gross,
            notes: `BIR Credit Memo (VAT reversal) for ${txn.ref_no}`,
            lines: lines.map((l) => ({
              item_id: l.item_id,
              description: l.description,
              qty: -Number(l.qty),
              rate: Number(l.rate),
              amount: -Number(l.amount),
            })),
          },
        });
        if (cmErr) throw cmErr;
        creditId = cmId;
      }

      await supabase
        .from("transactions")
        .update({
          rma_stage: stage,
          ...(disposition ? { rma_disposition: disposition } : {}),
          ...(creditId ? { credit_memo_txn_id: creditId, status: "closed" } : {}),
          ...(action === "refund" ? { status: "closed" } : {}),
        })
        .eq("id", rmaId);

      toast.success(`RMA moved to ${labelize(stage)}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update RMA");
    } finally {
      setBusy(false);
    }
  };

  const stage = q.data?.txn.rma_stage ?? "authorized";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-lg">
        <DialogHeader>
          <DialogTitle>RMA Workflow — {q.data?.txn.ref_no ?? ""}</DialogTitle>
        </DialogHeader>
        {q.data && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => (
                <Badge key={s} variant={stage === s ? "default" : "outline"}>
                  {stage === s && <CheckCircle2 className="mr-1 h-3 w-3" />}
                  {labelize(s)}
                </Badge>
              ))}
            </div>
            <div className="rounded-md border bg-muted p-3">
              <div><span className="text-muted-foreground">Customer:</span> {q.data.txn.party_name}</div>
              <div><span className="text-muted-foreground">Reason:</span> {q.data.txn.return_reason ?? "—"}</div>
              <div><span className="text-muted-foreground">Amount:</span> ₱{peso(q.data.txn.total)}</div>
            </div>
            {canWrite && (
              <div className="flex flex-wrap justify-end gap-2">
                {stage === "authorized" && <Button disabled={busy} onClick={() => void advance("received")}>Mark Received</Button>}
                {stage === "received" && <Button disabled={busy} onClick={() => void advance("inspected")}>Mark Inspected</Button>}
                {stage === "inspected" && (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => void advance("scrapped", "scrap")}>Scrap Item</Button>
                    <Button disabled={busy} onClick={() => void advance("restocked", "restock")}>Restock Inventory</Button>
                  </>
                )}
                {(stage === "restocked" || stage === "scrapped") && (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => void advance("refunded", undefined, "refund")}>Issue Refund</Button>
                    <Button disabled={busy} onClick={() => void advance("credited", undefined, "credit_memo")}>Issue BIR Credit Memo</Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
