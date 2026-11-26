import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RecRow {
  id: string;
  ref_no: string;
  txn_date: string;
  party_name: string | null;
  po_reference: string | null;
  status: string;
  total: number;
  location: string;
}

interface ReceiveLine {
  poLineId?: string;
  item_id: string;
  description: string;
  tracking: string;
  ordered: number;
  receivedAlready: number;
  receiveQty: number;
  unitCost: number;
  uom: string;
  lotNo: string;
  expiryDate: string;
  serialsText: string;
}

export const Route = createFileRoute("/_authenticated/receipts")({
  validateSearch: (s: Record<string, unknown>) => ({
    poId: typeof s["poId"] === "string" ? s["poId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Receipts — SOS Inventory" },
      { name: "description", content: "Receive purchase orders into inventory with lot, expiry, and serial tracking." },
    ],
  }),
  component: ReceiptsPage,
});

function ReceiptsPage() {
  const { poId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(!!poId);

  useEffect(() => {
    if (poId) setDrawerOpen(true);
  }, [poId]);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_name, po_reference, status, total, location:locations!transactions_location_id_fkey(name)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "receipt");
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%,po_reference.ilike.%${a.search}%`);
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
        party_name: d.party_name,
        po_reference: d.po_reference,
        status: d.status,
        total: Number(d.total),
        location: (d.location as unknown as { name: string } | null)?.name ?? "—",
      })) as RecRow[],
    };
  };

  const columns: Column<RecRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Receipt Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "vendor", header: "Vendor", cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    { key: "po", header: "PO Ref", cell: (r) => r.po_reference ?? "—", csv: (r) => r.po_reference ?? "" },
    { key: "location", header: "Location", cell: (r) => r.location, csv: (r) => r.location },
    { key: "status", header: "Status", cell: (r) => <Badge variant="secondary">{labelize(r.status)}</Badge>, csv: (r) => r.status },
    { key: "total", header: "Total", cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Receipts" subtitle="Receive vendor shipments, capture lots/expiry/serials, and update average cost" />
      {companyId && (
        <DataTable<RecRow>
          id="receipts"
          queryKey={["receipts", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <ReceiveDrawer
        open={drawerOpen}
        initialPoId={poId}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o && poId) void navigate({ search: { poId: undefined } });
        }}
        onCreated={() => qc.invalidateQueries({ queryKey: ["receipts", companyId] })}
      />
    </div>
  );
}

function ReceiveDrawer({
  open,
  initialPoId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  initialPoId: string | undefined;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { companyId } = useCompany();
  const [selectedPoId, setSelectedPoId] = useState(initialPoId ?? "");
  const [locationId, setLocationId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [poRef, setPoRef] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [busy, setBusy] = useState(false);

  const posQ = useQuery({
    queryKey: ["open_pos_for_rec", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, ref_no, party_id, party_name, location_id")
        .eq("company_id", companyId)
        .eq("type", "purchase_order")
        .eq("voided", false)
        .in("status", ["open", "partially_received"])
        .order("txn_date", { ascending: false });
      return data ?? [];
    },
  });

  const locsQ = useQuery({
    queryKey: ["rec_locs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, is_default").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["rec_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, uom, cost, tracking").eq("company_id", companyId).eq("archived", false).limit(400);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (initialPoId) setSelectedPoId(initialPoId);
  }, [initialPoId]);

  useEffect(() => {
    if (!selectedPoId) return;
    const loadPo = async () => {
      const po = (posQ.data ?? []).find((p) => p.id === selectedPoId);
      if (po) {
        setVendorId(po.party_id ?? "");
        setVendorName(po.party_name ?? "");
        setPoRef(po.ref_no);
        if (po.location_id) setLocationId(po.location_id);
      }
      const { data: poLines } = await supabase
        .from("transaction_lines")
        .select("*, item:items(tracking)")
        .eq("transaction_id", selectedPoId)
        .order("line_no");
      setLines(
        (poLines ?? []).map((l) => {
          const ordered = Number(l.qty);
          const rec = Number(l.qty_received ?? 0);
          const trk = (l.item as unknown as { tracking: string } | null)?.tracking ?? "none";
          return {
            poLineId: l.id,
            item_id: l.item_id ?? "",
            description: l.description ?? "",
            tracking: trk,
            ordered,
            receivedAlready: rec,
            receiveQty: Math.max(0, ordered - rec),
            unitCost: Number(l.rate),
            uom: l.uom ?? "pc",
            lotNo: trk === "lot" ? `LOT-${todayISO().replace(/-/g, "")}` : "",
            expiryDate: "",
            serialsText: "",
          };
        }),
      );
    };
    void loadPo();
  }, [selectedPoId, posQ.data]);

  useEffect(() => {
    if (!locationId && locsQ.data?.length) {
      const def = locsQ.data.find((l) => l.is_default) ?? locsQ.data[0];
      if (def) setLocationId(def.id);
    }
  }, [locationId, locsQ.data]);

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    const active = lines.filter((l) => l.receiveQty > 0);
    if (active.length === 0) return void toast.error("Enter at least one quantity to receive");
    if (!locationId) return void toast.error("Select a destination location");
    setBusy(true);
    try {
      const total = active.reduce((s, l) => s + l.receiveQty * l.unitCost, 0);
      const { data: recId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "receipt",
          status: "received",
          txn_date: todayISO(),
          party_type: vendorId ? "vendor" : null,
          party_id: vendorId || null,
          party_name: vendorName || "Direct Receipt",
          location_id: locationId,
          parent_txn_id: selectedPoId || null,
          po_reference: poRef || null,
          total,
          lines: active.map((l) => ({
            item_id: l.item_id,
            description: l.description,
            qty: l.receiveQty,
            uom: l.uom,
            rate: l.unitCost,
            amount: l.receiveQty * l.unitCost,
            source_line_id: l.poLineId ?? null,
          })),
        },
      });
      if (error) throw error;

      // Update inventory, lots, serials, cost history & PO line qty_received
      for (const l of active) {
        let lotId: string | null = null;
        if (l.tracking === "lot" && l.lotNo.trim()) {
          const { data: existingLot } = await supabase
            .from("item_lots")
            .select("id")
            .eq("company_id", companyId)
            .eq("item_id", l.item_id)
            .eq("lot_no", l.lotNo.trim())
            .maybeSingle();
          if (existingLot) {
            lotId = existingLot.id;
          } else {
            const { data: newLot } = await supabase
              .from("item_lots")
              .insert({
                company_id: companyId,
                item_id: l.item_id,
                lot_no: l.lotNo.trim(),
                received_date: todayISO(),
                expiry_date: l.expiryDate || null,
              })
              .select("id")
              .single();
            lotId = newLot?.id ?? null;
          }
        }

        if (l.tracking === "serial" && l.serialsText.trim()) {
          const serials = l.serialsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
          for (const sn of serials) {
            const { data: insSer } = await supabase
              .from("item_serials")
              .insert({
                company_id: companyId,
                item_id: l.item_id,
                location_id: locationId,
                lot_id: lotId,
                serial_no: sn,
                status: "in_stock",
                unit_cost: l.unitCost,
              })
              .select("id")
              .single();
            await adjustInventoryLevel({
              companyId,
              itemId: l.item_id,
              locationId,
              lotId,
              serialId: insSer?.id ?? null,
              delta: 1,
              unitCost: l.unitCost,
              txnDate: todayISO(),
              txnRef: poRef ? `REC-${poRef}` : "RECEIPT",
              transactionId: recId,
            });
          }
        } else {
          await adjustInventoryLevel({
            companyId,
            itemId: l.item_id,
            locationId,
            lotId,
            delta: l.receiveQty,
            unitCost: l.unitCost,
            txnDate: todayISO(),
            txnRef: poRef ? `REC-${poRef}` : "RECEIPT",
            transactionId: recId,
          });
        }

        if (l.poLineId) {
          await supabase
            .from("transaction_lines")
            .update({ qty_received: l.receivedAlready + l.receiveQty })
            .eq("id", l.poLineId);
        }
      }

      if (selectedPoId) {
        const allDone = lines.every((l) => l.receivedAlready + l.receiveQty >= l.ordered);
        await supabase
          .from("transactions")
          .update({ status: allDone ? "received" : "partially_received" })
          .eq("id", selectedPoId);
      }

      toast.success("Receipt posted & inventory updated");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post receipt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Receive Inventory</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleReceive} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rec-po">Purchase Order (optional)</Label>
              <select
                id="rec-po"
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">Standalone receipt…</option>
                {(posQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.ref_no} — {p.party_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="rec-loc">Destination Location *</Label>
              <select
                id="rec-loc"
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
          </div>

          {!selectedPoId && (
            <div>
              <Label htmlFor="rec-add-item">Add Item</Label>
              <select
                id="rec-add-item"
                value=""
                onChange={(e) => {
                  const it = (itemsQ.data ?? []).find((x) => x.id === e.target.value);
                  if (!it) return;
                  setLines((prev) => [
                    ...prev,
                    {
                      item_id: it.id,
                      description: `${it.sku} — ${it.name}`,
                      tracking: it.tracking,
                      ordered: 1,
                      receivedAlready: 0,
                      receiveQty: 1,
                      unitCost: Number(it.cost ?? 0),
                      uom: it.uom,
                      lotNo: it.tracking === "lot" ? `LOT-${todayISO().replace(/-/g, "")}` : "",
                      expiryDate: "",
                      serialsText: "",
                    },
                  ]);
                }}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">+ Add item to receive…</option>
                {(itemsQ.data ?? []).map((it) => (
                  <option key={it.id} value={it.id}>{it.sku} — {it.name} ({it.tracking})</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-3">
            {lines.map((l, idx) => (
              <div key={idx} className="rounded-md border bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                  <span>{l.description}</span>
                  <Badge variant="outline">{l.tracking}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Receive Qty</Label>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      value={l.receiveQty}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, receiveQty: Number(e.target.value) || 0 } : x)))}
                      className="mt-1 h-8 rounded-md"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit Cost (₱)</Label>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      value={l.unitCost}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unitCost: Number(e.target.value) || 0 } : x)))}
                      className="mt-1 h-8 rounded-md"
                    />
                  </div>
                  {l.tracking === "lot" && (
                    <>
                      <div>
                        <Label className="text-xs">Lot #</Label>
                        <Input
                          value={l.lotNo}
                          onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, lotNo: e.target.value } : x)))}
                          className="mt-1 h-8 rounded-md"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Expiry Date</Label>
                        <Input
                          type="date"
                          value={l.expiryDate}
                          onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, expiryDate: e.target.value } : x)))}
                          className="mt-1 h-8 rounded-md"
                        />
                      </div>
                    </>
                  )}
                  {l.tracking === "serial" && (
                    <div className="col-span-2">
                      <Label className="text-xs">Serial Numbers (comma or newline separated)</Label>
                      <Input
                        value={l.serialsText}
                        onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, serialsText: e.target.value } : x)))}
                        placeholder="SN-001, SN-002"
                        className="mt-1 h-8 rounded-md"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <PackageCheck className="mr-1.5 h-4 w-4" />
              Post Receipt
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
