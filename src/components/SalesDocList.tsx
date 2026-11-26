import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type TxnType = Database["public"]["Enums"]["txn_type"];

interface DocRow {
  id: string;
  ref_no: string;
  txn_date: string;
  party_name: string | null;
  status: string;
  total: number;
  notes: string | null;
  voided: boolean;
}

export function SalesDocList({
  type,
  title,
  subtitle,
  printable,
}: {
  type: TxnType;
  title: string;
  subtitle: string;
  printable?: boolean;
}) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_name, status, total, notes, voided", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", type);
    if (a.filter && a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%,notes.ilike.%${a.search}%`);
    const sortMap: Record<string, string> = { ref: "ref_no", date: "txn_date", customer: "party_name", total: "total" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as DocRow[], total: count ?? 0 };
  };

  const columns: Column<DocRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => setSelectedId(r.id)}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", sortable: true, cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.voided ? "destructive" : "outline"}>{r.voided ? "Voided" : labelize(r.status)}</Badge>,
      csv: (r) => r.status,
    },
    { key: "total", header: "Total", sortable: true, cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "—", csv: (r) => r.notes ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title={title} subtitle={subtitle} />
      {companyId && (
        <DataTable<DocRow>
          id={type}
          queryKey={[type, companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          rowActions={[{ label: "View details", onSelect: (rows) => rows[0] && setSelectedId(rows[0].id) }]}
          {...(canWrite ? { onAdd: () => setCreateOpen(true) } : {})}
        />
      )}
      {selectedId && (
        <DocDetailDialog
          txnId={selectedId}
          printable={printable}
          onClose={() => setSelectedId(null)}
        />
      )}
      <QuickCreateDocDrawer
        type={type}
        title={`New ${title.slice(0, -1)}`}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: [type, companyId] })}
      />
    </div>
  );
}

function DocDetailDialog({ txnId, printable, onClose }: { txnId: string; printable?: boolean | undefined; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["doc_detail", txnId],
    queryFn: async () => {
      const { data: txn, error } = await supabase
        .from("transactions")
        .select("*, location:locations!transactions_location_id_fkey(name)")
        .eq("id", txnId)
        .single();
      if (error) throw error;
      const { data: lines } = await supabase
        .from("transaction_lines")
        .select("*, item:items(sku, name, uom), lot:item_lots(lot_no, expiry_date)")
        .eq("transaction_id", txnId)
        .order("line_no");
      return { txn, lines: lines ?? [] };
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{q.data?.txn.ref_no ?? "Document"}</span>
            {printable && (
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" />
                Print
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.data && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3">
              <div><span className="text-muted-foreground">Customer:</span> {q.data.txn.party_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Date:</span> {fmtDate(q.data.txn.txn_date)}</div>
              <div><span className="text-muted-foreground">Location:</span> {(q.data.txn.location as unknown as { name: string } | null)?.name ?? "—"}</div>
              <div><span className="text-muted-foreground">Status:</span> {labelize(q.data.txn.status)}</div>
            </div>
            {q.data.lines.length > 0 && (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5">Lot (FEFO)</th>
                    <th className="py-1.5 text-right">Qty</th>
                    <th className="py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.lines.map((l) => {
                    const it = l.item as unknown as { sku: string; name: string; uom: string } | null;
                    const lot = l.lot as unknown as { lot_no: string; expiry_date: string | null } | null;
                    return (
                      <tr key={l.id} className="border-b">
                        <td className="py-1.5">{l.description ?? it?.name ?? "—"}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          {lot ? `${lot.lot_no} (${fmtDate(lot.expiry_date)})` : "—"}
                        </td>
                        <td className="py-1.5 text-right">{num(l.qty, 2)} {it?.uom ?? ""}</td>
                        <td className="py-1.5 text-right">₱{peso(l.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="flex justify-between border-t pt-2 font-medium">
              <span>Total</span>
              <span>₱{peso(q.data.txn.total)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickCreateDocDrawer({
  type,
  title,
  open,
  onOpenChange,
  onCreated,
}: {
  type: TxnType;
  title: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { companyId } = useCompany();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("0");
  const [ewtAmount, setEwtAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const custQ = useQuery({
    queryKey: ["doc_custs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, name, default_atc").eq("company_id", companyId).eq("archived", false).order("name").limit(200);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = (custQ.data ?? []).find((c) => c.id === customerId);
    if (!cust) return void toast.error("Select a customer");
    setBusy(true);
    try {
      const tot = Number(amount) || 0;
      const ewt = Number(ewtAmount) || 0;
      const { error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type,
          status: type === "payment" ? "closed" : "open",
          txn_date: todayISO(),
          party_type: "customer",
          party_id: cust.id,
          party_name: cust.name,
          ewt_atc: cust.default_atc ?? null,
          ewt_amount: ewt,
          vatable_sales: tot,
          total: tot,
          amount_due: Math.max(0, tot - ewt),
          notes: notes.trim() || null,
          lines: [],
        },
      });
      if (error) throw error;
      toast.success(`${title} created`);
      setCustomerId("");
      setAmount("0");
      setEwtAmount("0");
      setNotes("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="qd-cust">Customer *</Label>
            <select id="qd-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select customer…</option>
              {(custQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="qd-amt">Amount (₱)</Label>
            <Input id="qd-amt" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 rounded-md" />
          </div>
          {type === "payment" && (
            <div>
              <Label htmlFor="qd-ewt">EWT Withheld (₱)</Label>
              <Input id="qd-ewt" type="number" step="any" value={ewtAmount} onChange={(e) => setEwtAmount(e.target.value)} className="mt-1 rounded-md" />
            </div>
          )}
          <div>
            <Label htmlFor="qd-notes">Notes</Label>
            <Input id="qd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
