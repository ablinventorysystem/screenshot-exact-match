import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface TransferRow {
  id: string;
  ref_no: string;
  txn_date: string;
  status: string;
  notes: string | null;
  from_loc: string;
  to_loc: string;
}

export const Route = createFileRoute("/_authenticated/transfers")({
  head: () => ({
    meta: [
      { title: "Transfers — SOS Inventory" },
      { name: "description", content: "Location-to-location stock transfers with partial receive." },
    ],
  }),
  component: TransfersPage,
});

function TransfersPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select(
        "id, ref_no, txn_date, status, notes, from_loc:locations!transactions_location_id_fkey(name), to_loc:locations!transactions_to_location_id_fkey(name)",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .eq("type", "transfer");
    if (a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,notes.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return {
      total: count ?? 0,
      rows: (data ?? []).map((d) => ({
        id: d.id,
        ref_no: d.ref_no,
        txn_date: d.txn_date,
        status: d.status,
        notes: d.notes,
        from_loc: (d.from_loc as unknown as { name: string } | null)?.name ?? "—",
        to_loc: (d.to_loc as unknown as { name: string } | null)?.name ?? "—",
      })) as TransferRow[],
    };
  };

  const columns: Column<TransferRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => setReceiveId(r.id)}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "from", header: "From Location", cell: (r) => r.from_loc, csv: (r) => r.from_loc },
    { key: "to", header: "To Location", cell: (r) => r.to_loc, csv: (r) => r.to_loc },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Badge variant={r.status === "received" ? "secondary" : r.status === "in_transit" ? "outline" : "outline"}>
          {labelize(r.status)}
        </Badge>
      ),
      csv: (r) => r.status,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "—", csv: (r) => r.notes ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Transfers" subtitle="Move inventory between locations (Pending / In transit / Received)" />
      {companyId && (
        <DataTable<TransferRow>
          id="transfers"
          queryKey={["transfers", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "in_transit", label: "In transit" },
            { value: "received", label: "Received" },
          ]}
          rowActions={[{ label: "Open / Receive", onSelect: (rows) => rows[0] && setReceiveId(rows[0].id) }]}
          {...(canWrite ? { onAdd: () => setCreateOpen(true) } : {})}
        />
      )}
      <CreateTransferDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["transfers", companyId] })}
      />
      {receiveId && (
        <TransferReceiveDialog
          transferId={receiveId}
          onClose={() => setReceiveId(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ["transfers", companyId] })}
        />
      )}
    </div>
  );
}

function CreateTransferDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { companyId } = useCompany();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const locsQ = useQuery({
    queryKey: ["tr_locs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["tr_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, uom, cost").eq("company_id", companyId).eq("archived", false).order("name").limit(400);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId || fromId === toId) return void toast.error("Choose different source and destination locations");
    if (!itemId) return void toast.error("Select an item");
    const q = Number(qty) || 0;
    if (q <= 0) return void toast.error("Enter a positive quantity");
    setBusy(true);
    try {
      const it = (itemsQ.data ?? []).find((x) => x.id === itemId)!;
      const { data: trId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "transfer",
          status: "in_transit",
          txn_date: todayISO(),
          location_id: fromId,
          to_location_id: toId,
          notes: notes.trim() || null,
          lines: [{ item_id: it.id, description: `${it.sku} — ${it.name}`, qty: q, uom: it.uom, rate: Number(it.cost ?? 0), amount: q * Number(it.cost ?? 0) }],
        },
      });
      if (error) throw error;
      // Deduct from source location immediately as In Transit
      await adjustInventoryLevel({
        companyId,
        itemId: it.id,
        locationId: fromId,
        delta: -q,
        txnDate: todayISO(),
        txnRef: "TRANSFER-OUT",
        transactionId: trId,
      });
      toast.success("Transfer created (In transit)");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create transfer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New Stock Transfer</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="tr-from">From Location *</Label>
            <select id="tr-from" value={fromId} onChange={(e) => setFromId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select source…</option>
              {(locsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="tr-to">To Location *</Label>
            <select id="tr-to" value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select destination…</option>
              {(locsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="tr-item">Item *</Label>
            <select id="tr-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select item…</option>
              {(itemsQ.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="tr-qty">Quantity *</Label>
            <Input id="tr-qty" type="number" step="any" min="0.000001" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="tr-notes">Notes</Label>
            <Input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              Dispatch Transfer
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function TransferReceiveDialog({ transferId, onClose, onDone }: { transferId: string; onClose: () => void; onDone: () => void }) {
  const { companyId, canWrite } = useCompany();
  const [recvMap, setRecvMap] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["tr_detail", transferId],
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", transferId).single();
      if (error) throw error;
      const { data: lines } = await supabase.from("transaction_lines").select("*").eq("transaction_id", transferId).order("line_no");
      return { txn, lines: lines ?? [] };
    },
  });

  useEffect(() => {
    if (!q.data) return;
    const m: Record<string, number> = {};
    for (const l of q.data.lines) m[l.id] = Math.max(0, Number(l.qty) - Number(l.qty_received ?? 0));
    setRecvMap(m);
  }, [q.data]);

  const handleReceive = async () => {
    if (!q.data || !q.data.txn.to_location_id) return;
    setBusy(true);
    try {
      for (const l of q.data.lines) {
        const add = Number(recvMap[l.id] ?? 0);
        if (add <= 0 || !l.item_id) continue;
        await adjustInventoryLevel({
          companyId,
          itemId: l.item_id,
          locationId: q.data.txn.to_location_id,
          delta: add,
          txnDate: todayISO(),
          txnRef: `TR-IN-${q.data.txn.ref_no}`,
          transactionId: transferId,
        });
        await supabase.from("transaction_lines").update({ qty_received: Number(l.qty_received ?? 0) + add }).eq("id", l.id);
      }
      const allDone = q.data.lines.every((l) => Number(l.qty_received ?? 0) + Number(recvMap[l.id] ?? 0) >= Number(l.qty));
      await supabase.from("transactions").update({ status: allDone ? "received" : "in_transit" }).eq("id", transferId);
      toast.success("Transfer received into destination");
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to receive transfer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-lg">
        <DialogHeader>
          <DialogTitle>Transfer {q.data?.txn.ref_no ?? ""}</DialogTitle>
        </DialogHeader>
        {q.data && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Status: {labelize(q.data.txn.status)}</p>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5">Item</th>
                  <th className="py-1.5 text-right">Sent</th>
                  <th className="py-1.5 text-right">Received</th>
                  <th className="py-1.5 text-right">Receive Now</th>
                </tr>
              </thead>
              <tbody>
                {q.data.lines.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right">{num(l.qty, 2)}</td>
                    <td className="py-1.5 text-right">{num(l.qty_received ?? 0, 2)}</td>
                    <td className="py-1.5 text-right">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={recvMap[l.id] ?? 0}
                        onChange={(e) => setRecvMap({ ...recvMap, [l.id]: Number(e.target.value) || 0 })}
                        className="ml-auto h-7 w-20 rounded-md text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canWrite && q.data.txn.status !== "received" && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button disabled={busy} onClick={() => void handleReceive()}>
                  <PackageCheck className="mr-1.5 h-4 w-4" />
                  Confirm Receive
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
