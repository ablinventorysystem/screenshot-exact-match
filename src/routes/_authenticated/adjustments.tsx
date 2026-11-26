import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface AdjRow {
  id: string;
  ref_no: string;
  txn_date: string;
  status: string;
  notes: string | null;
  location: string;
}

export const Route = createFileRoute("/_authenticated/adjustments")({
  head: () => ({
    meta: [
      { title: "Adjustments — SOS Inventory" },
      { name: "description", content: "Create and post inventory quantity adjustments." },
    ],
  }),
  component: AdjustmentsPage,
});

function AdjustmentsPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, status, notes, location:locations!transactions_location_id_fkey(name)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "adjustment");
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
        location: (d.location as unknown as { name: string } | null)?.name ?? "—",
      })),
    };
  };

  const columns: Column<AdjRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "location", header: "Location", cell: (r) => r.location, csv: (r) => r.location },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.status === "closed" ? "secondary" : "outline"}>{labelize(r.status)}</Badge>,
      csv: (r) => r.status,
    },
    { key: "notes", header: "Reason / Notes", cell: (r) => r.notes ?? "—", csv: (r) => r.notes ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Adjustments" subtitle="Post quantity and cost adjustments to inventory levels" />
      {companyId && (
        <DataTable<AdjRow>
          id="adjustments"
          queryKey={["adjustments", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <CreateAdjustmentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onPosted={() => {
          qc.invalidateQueries({ queryKey: ["adjustments", companyId] });
          qc.invalidateQueries({ queryKey: ["items", companyId] });
        }}
      />
    </div>
  );
}

function CreateAdjustmentDrawer({
  open,
  onOpenChange,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPosted: () => void;
}) {
  const { companyId } = useCompany();
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotId, setLotId] = useState("");
  const [delta, setDelta] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [txnDate, setTxnDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const locsQ = useQuery({
    queryKey: ["locs_min", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, is_default").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["items_adj", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, cost, tracking").eq("company_id", companyId).eq("archived", false).order("sku").limit(300);
      return data ?? [];
    },
  });

  const selectedItem = (itemsQ.data ?? []).find((i) => i.id === itemId);

  const lotsQ = useQuery({
    queryKey: ["adj_lots", itemId],
    enabled: !!itemId && selectedItem?.tracking === "lot",
    queryFn: async () => {
      const { data } = await supabase.from("item_lots").select("id, lot_no").eq("item_id", itemId);
      return data ?? [];
    },
  });

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const effLoc = locationId || locsQ.data?.[0]?.id || "";
    const qtyDelta = Number(delta);
    if (!effLoc || !itemId || !qtyDelta) {
      toast.error("Location, item, and non-zero quantity delta are required");
      return;
    }
    setBusy(true);
    try {
      const costVal = unitCost ? Number(unitCost) : Number(selectedItem?.cost ?? 0);
      const { data: txnId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "adjustment",
          status: "closed",
          txn_date: txnDate,
          location_id: effLoc,
          notes: notes.trim() || "Inventory adjustment",
          total: Math.abs(qtyDelta) * costVal,
          lines: [
            {
              item_id: itemId,
              description: selectedItem?.name ?? "",
              qty: qtyDelta,
              rate: costVal,
              amount: qtyDelta * costVal,
              lot_id: lotId || null,
            },
          ],
        },
      });
      if (error) throw error;

      await adjustInventoryLevel({
        companyId,
        itemId,
        locationId: effLoc,
        lotId: lotId || null,
        delta: qtyDelta,
        unitCost: costVal,
        txnDate,
        txnRef: `ADJ-${txnDate}`,
        transactionId: txnId,
      });

      toast.success("Inventory adjustment posted");
      setItemId("");
      setLotId("");
      setDelta("1");
      setNotes("");
      onOpenChange(false);
      onPosted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post adjustment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New inventory adjustment</SheetTitle>
        </SheetHeader>
        <form onSubmit={handlePost} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="adj-date">Date</Label>
            <Input id="adj-date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="adj-loc">Location</Label>
            <select
              id="adj-loc"
              value={locationId || locsQ.data?.[0]?.id || ""}
              onChange={(e) => setLocationId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              {(locsQ.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="adj-item">Item *</Label>
            <select
              id="adj-item"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setLotId("");
              }}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">Select item…</option>
              {(itemsQ.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>
              ))}
            </select>
          </div>
          {selectedItem?.tracking === "lot" && (
            <div>
              <Label htmlFor="adj-lot">Lot</Label>
              <select
                id="adj-lot"
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">No lot / General</option>
                {(lotsQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.lot_no}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="adj-delta">Qty change (+/-) *</Label>
              <Input id="adj-delta" type="number" step="any" value={delta} onChange={(e) => setDelta(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="adj-cost">Unit cost (₱)</Label>
              <Input
                id="adj-cost"
                type="number"
                step="any"
                placeholder={selectedItem ? String(selectedItem.cost) : "0"}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="mt-1 rounded-md"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="adj-notes">Reason / Notes</Label>
            <Input id="adj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cycle count, spoilage, opening stock…" className="mt-1 rounded-md" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Post adjustment</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
