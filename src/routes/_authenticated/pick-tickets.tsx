import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Package, ScanLine, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { BarcodeScanBar } from "@/components/BarcodeTools";
import { downloadPackingSlipPdf, downloadShippingLabelPdf } from "@/components/ShippingPdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PickRow {
  id: string;
  ref_no: string;
  txn_date: string;
  party_name: string | null;
  status: string;
  packed_at: string | null;
  tracking_no: string | null;
}

const PH_CARRIERS = ["LBC Express", "J&T Express", "JRS Express", "2GO Express", "Lalamove", "UPS"];

function playBeep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = ok ? "sine" : "sawtooth";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.28));
  } catch {
    // AudioContext blocked or unavailable
  }
}

export const Route = createFileRoute("/_authenticated/pick-tickets")({
  head: () => ({
    meta: [
      { title: "Pick tickets — ABL Inventory" },
      { name: "description", content: "Pick, Pack, and Ship warehouse fulfillment with barcode scanning." },
    ],
  }),
  component: PickTicketsPage,
});

function PickTicketsPage() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_name, status, packed_at, tracking_no", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "pick_ticket");
    if (a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as PickRow[], total: count ?? 0 };
  };

  const columns: Column<PickRow>[] = [
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
    { key: "packed", header: "Packed", cell: (r) => (r.packed_at ? "Yes" : "No"), csv: (r) => (r.packed_at ? "Yes" : "No") },
    { key: "tracking", header: "Tracking #", cell: (r) => r.tracking_no ?? "—", csv: (r) => r.tracking_no ?? "" },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.status === "shipped" ? "secondary" : "outline"}>{labelize(r.status)}</Badge>,
      csv: (r) => r.status,
    },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Pick tickets" subtitle="Warehouse Pick (barcode scan), Pack (packing slip PDF), and Ship (PH couriers & mock labels)" />
      {companyId && (
        <DataTable<PickRow>
          id="pick_tickets"
          queryKey={["pick_tickets", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "packed", label: "Packed" },
            { value: "shipped", label: "Shipped" },
          ]}
          rowActions={[{ label: "Pick / Pack / Ship", onSelect: (rows) => rows[0] && setActiveId(rows[0].id) }]}
        />
      )}
      {activeId && (
        <PickPackShipDialog
          pickId={activeId}
          onClose={() => setActiveId(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ["pick_tickets", companyId] })}
        />
      )}
    </div>
  );
}

function PickPackShipDialog({ pickId, onClose, onDone }: { pickId: string; onClose: () => void; onDone: () => void }) {
  const { company, companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [scanError, setScanError] = useState<string | null>(null);
  const [carrier, setCarrier] = useState(PH_CARRIERS[0]!);
  const [trackingNo, setTrackingNo] = useState("");
  const [weight, setWeight] = useState("1.0");
  const [provider, setProvider] = useState<"manual" | "shipstation" | "ups">("manual");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["pick_detail", pickId],
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", pickId).single();
      if (error) throw error;
      const { data: lines } = await supabase
        .from("transaction_lines")
        .select("*, item:items(id, sku, name, uom, barcode), lot:item_lots(lot_no)")
        .eq("transaction_id", pickId)
        .order("line_no");
      return { txn, lines: lines ?? [] };
    },
  });

  const confirmLine = async (lineId: string, picked: boolean) => {
    await supabase
      .from("transaction_lines")
      .update({ picked, picked_at: picked ? new Date().toISOString() : null })
      .eq("id", lineId);
    qc.invalidateQueries({ queryKey: ["pick_detail", pickId] });
  };

  const handleScanMatch = async (itemId: string, label: string) => {
    const matchLine = (q.data?.lines ?? []).find((l) => l.item_id === itemId && !l.picked);
    if (!matchLine) {
      playBeep(false);
      setScanError(`Scanned "${label}" does not match any unpicked line on this ticket.`);
      return;
    }
    playBeep(true);
    setScanError(null);
    await confirmLine(matchLine.id, true);
    toast.success(`Picked: ${label}`);
  };

  const handlePack = async () => {
    if (!q.data || !company) return;
    await supabase.from("transactions").update({ status: "packed", packed_at: new Date().toISOString() }).eq("id", pickId);
    await downloadPackingSlipPdf({
      companyName: company.name,
      refNo: q.data.txn.ref_no,
      txnDate: q.data.txn.txn_date,
      customerName: q.data.txn.party_name ?? "Customer",
      shipTo: q.data.txn.ship_to,
      lines: q.data.lines.map((l) => ({
        description: l.description ?? "",
        qty: Number(l.qty),
        uom: l.uom ?? "pc",
        lotNo: (l.lot as unknown as { lot_no: string } | null)?.lot_no ?? null,
      })),
    });
    toast.success("Marked packed & downloaded Packing Slip PDF");
    qc.invalidateQueries({ queryKey: ["pick_detail", pickId] });
    onDone();
  };

  const handleShip = async (useMockLabel: boolean) => {
    if (!q.data || !company) return;
    const effProvider = useMockLabel ? (carrier === "UPS" ? "ups" : "shipstation") : provider;
    const effTracking = trackingNo.trim() || `${effProvider.toUpperCase()}-${Date.now().toString().slice(-8)}`;
    setBusy(true);
    try {
      const { txn, lines } = q.data;
      const { data: shipId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "shipment",
          status: "shipped",
          txn_date: todayISO(),
          party_type: "customer",
          party_id: txn.party_id,
          party_name: txn.party_name,
          location_id: txn.location_id,
          parent_txn_id: txn.parent_txn_id ?? pickId,
          carrier,
          tracking_no: effTracking,
          package_weight: Number(weight) || 1,
          shipping_provider: effProvider,
          notes: `Shipped via ${carrier} (${effTracking})`,
          lines: lines.map((l) => ({
            item_id: l.item_id,
            description: l.description,
            qty: Number(l.qty),
            uom: l.uom,
            rate: Number(l.rate),
            amount: Number(l.amount),
            lot_id: l.lot_id,
            serial_id: l.serial_id,
          })),
        },
      });
      if (error) throw error;

      if (txn.location_id) {
        for (const l of lines) {
          if (!l.item_id) continue;
          await adjustInventoryLevel({
            companyId,
            itemId: l.item_id,
            locationId: txn.location_id,
            lotId: l.lot_id,
            serialId: l.serial_id,
            delta: -Number(l.qty),
            txnDate: todayISO(),
            txnRef: `SH-${txn.ref_no}`,
            transactionId: shipId,
          });
        }
      }

      await supabase.from("transactions").update({ status: "shipped", tracking_no: effTracking, carrier, shipped_at: new Date().toISOString() }).eq("id", pickId);

      if (useMockLabel) {
        await downloadShippingLabelPdf({
          provider: effProvider,
          carrier,
          trackingNo: effTracking,
          refNo: txn.ref_no,
          fromCompany: company.name,
          toCustomer: txn.party_name ?? "Customer",
          toAddress: txn.ship_to,
          weightKg: Number(weight) || 1,
        });
      }

      toast.success(`Shipped via ${carrier} (${effTracking})`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to ship");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-teal" />
            <span>Fulfillment — {q.data?.txn.ref_no ?? ""}</span>
          </DialogTitle>
        </DialogHeader>

        {q.data && (
          <Tabs defaultValue="pick">
            <TabsList className="mb-3 grid w-full grid-cols-3">
              <TabsTrigger value="pick" className="h-10">1. Pick (Scan)</TabsTrigger>
              <TabsTrigger value="pack" className="h-10">2. Pack</TabsTrigger>
              <TabsTrigger value="ship" className="h-10">3. Ship</TabsTrigger>
            </TabsList>

            <TabsContent value="pick" className="space-y-3">
              <BarcodeScanBar
                placeholder="Scan item, SKU, lot #, or serial # to confirm…"
                onMatch={(m) => void handleScanMatch(m.itemId, m.label)}
              />
              {scanError && (
                <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  {scanError}
                </div>
              )}
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {q.data.lines.map((l) => {
                  const lot = l.lot as unknown as { lot_no: string } | null;
                  return (
                    <div
                      key={l.id}
                      className={`flex min-h-[52px] items-center justify-between gap-3 rounded-md border p-3 ${l.picked ? "bg-accent" : "bg-surface"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.description}</div>
                        <div className="text-xs text-muted-foreground">
                          Qty: {num(l.qty, 2)} {l.uom ?? "pc"} {lot ? `· Lot ${lot.lot_no}` : ""}
                        </div>
                      </div>
                      {canWrite && (
                        <Button
                          size="sm"
                          variant={l.picked ? "secondary" : "default"}
                          className="h-10 min-w-[96px]"
                          onClick={() => void confirmLine(l.id, !l.picked)}
                        >
                          {l.picked ? (
                            <>
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Picked
                            </>
                          ) : (
                            "Tap Pick"
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="pack" className="space-y-4">
              <div className="rounded-md border bg-muted p-4 text-sm">
                <p>Picked lines: {q.data.lines.filter((l) => l.picked).length} / {q.data.lines.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packing generates a PDF packing slip and marks this ticket as Packed.</p>
              </div>
              {canWrite && (
                <Button className="h-11 w-full" onClick={() => void handlePack()}>
                  <Package className="mr-2 h-4 w-4" />
                  Mark Packed &amp; Download Packing Slip PDF
                </Button>
              )}
            </TabsContent>

            <TabsContent value="ship" className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="sh-car">Carrier (PH Couriers / UPS)</Label>
                  <select id="sh-car" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-surface px-3 text-sm">
                    {PH_CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="sh-wt">Package Weight (kg)</Label>
                  <Input id="sh-wt" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1 h-10 rounded-md" />
                </div>
                <div>
                  <Label htmlFor="sh-trk">Tracking Number (auto if blank)</Label>
                  <Input id="sh-trk" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="LBC-123456789" className="mt-1 h-10 rounded-md" />
                </div>
                <div>
                  <Label htmlFor="sh-prov">Integration Mode</Label>
                  <select id="sh-prov" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className="mt-1 h-10 w-full rounded-md border bg-surface px-3 text-sm">
                    <option value="manual">Manual Courier</option>
                    <option value="shipstation">ShipStation (Mock)</option>
                    <option value="ups">UPS (Mock)</option>
                  </select>
                </div>
              </div>
              {canWrite && (
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button variant="outline" disabled={busy} onClick={() => void handleShip(true)}>
                    <FileText className="mr-1.5 h-4 w-4" />
                    Ship &amp; Generate Mock Label PDF
                  </Button>
                  <Button disabled={busy} onClick={() => void handleShip(false)}>
                    <Truck className="mr-1.5 h-4 w-4" />
                    Confirm Shipment
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
