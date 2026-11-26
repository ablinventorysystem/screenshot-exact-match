import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { num, todayISO } from "@/lib/format";
import { adjustInventoryLevel, getItemAvailability } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface ReadyLine {
  lineId: string;
  soId: string;
  soRef: string;
  customerId: string | null;
  customerName: string;
  locationId: string | null;
  locationName: string;
  itemId: string;
  description: string;
  uom: string;
  rate: number;
  remaining: number;
  available: number;
}

export const Route = createFileRoute("/_authenticated/ready-to-ship")({
  head: () => ({
    meta: [
      { title: "Ready to pick/ship — ABL Inventory" },
      { name: "description", content: "Open sales order lines with available stock ready for batch pick tickets or shipments." },
    ],
  }),
  component: ReadyToShipPage,
});

function ReadyToShipPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [groupBy, setGroupBy] = useState<"customer" | "location">("customer");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["ready_to_ship", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_lines")
        .select(
          "id, item_id, description, qty, qty_fulfilled, uom, rate, txn:transactions!inner(id, ref_no, party_id, party_name, location_id, type, status, voided, location:locations!transactions_location_id_fkey(name))",
        )
        .eq("company_id", companyId)
        .eq("txn.type", "sales_order")
        .eq("txn.voided", false)
        .in("txn.status", ["open", "pending", "partially_shipped", "partially_invoiced"]);
      if (error) throw error;

      const openLines = (data ?? []).filter((l) => Number(l.qty) > Number(l.qty_fulfilled));
      const uniqueKeys = Array.from(
        new Set(
          openLines.map((l) => {
            const t = l.txn as unknown as { location_id: string | null };
            return `${l.item_id}::${t.location_id ?? ""}`;
          }),
        ),
      );
      const availMap = new Map<string, number>();
      await Promise.all(
        uniqueKeys.map(async (k) => {
          const [itemId, locId] = k.split("::");
          if (!itemId) return;
          const av = await getItemAvailability(companyId, itemId, locId || null);
          availMap.set(k, av.available);
        }),
      );

      return openLines.map((l) => {
        const t = l.txn as unknown as {
          id: string;
          ref_no: string;
          party_id: string | null;
          party_name: string | null;
          location_id: string | null;
          location: { name: string } | null;
        };
        const remaining = Math.max(0, Number(l.qty) - Number(l.qty_fulfilled));
        const available = availMap.get(`${l.item_id}::${t.location_id ?? ""}`) ?? 0;
        return {
          lineId: l.id,
          soId: t.id,
          soRef: t.ref_no,
          customerId: t.party_id,
          customerName: t.party_name ?? "Walk-in",
          locationId: t.location_id,
          locationName: t.location?.name ?? "Unassigned",
          itemId: l.item_id ?? "",
          description: l.description ?? "",
          uom: l.uom ?? "pc",
          rate: Number(l.rate),
          remaining,
          available,
        } as ReadyLine;
      });
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, ReadyLine[]>();
    for (const r of q.data ?? []) {
      const key = groupBy === "customer" ? r.customerName : r.locationName;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [q.data, groupBy]);

  const batchCreate = async (kind: "pick_ticket" | "shipment") => {
    const chosen = (q.data ?? []).filter((r) => selected.has(r.lineId));
    if (chosen.length === 0) return void toast.error("Select at least one line");
    setBusy(true);
    try {
      // Group by Sales Order
      const bySo = new Map<string, ReadyLine[]>();
      for (const r of chosen) {
        const arr = bySo.get(r.soId) ?? [];
        arr.push(r);
        bySo.set(r.soId, arr);
      }

      for (const [soId, soLines] of bySo.entries()) {
        const first = soLines[0]!;
        const { data: docId, error } = await supabase.rpc("save_transaction", {
          p: {
            company_id: companyId,
            type: kind,
            status: kind === "shipment" ? "shipped" : "open",
            txn_date: todayISO(),
            party_type: "customer",
            party_id: first.customerId,
            party_name: first.customerName,
            location_id: first.locationId,
            parent_txn_id: soId,
            notes: `Batch ${kind.replace("_", " ")} for ${first.soRef}`,
            lines: soLines.map((l) => ({
              item_id: l.itemId,
              description: l.description,
              qty: l.remaining,
              uom: l.uom,
              rate: l.rate,
              amount: l.remaining * l.rate,
              source_line_id: l.lineId,
            })),
          },
        });
        if (error) throw error;

        if (kind === "shipment") {
          for (const l of soLines) {
            await supabase.from("transaction_lines").update({ qty_fulfilled: l.remaining }).eq("id", l.lineId);
            if (l.locationId) {
              await adjustInventoryLevel({
                companyId,
                itemId: l.itemId,
                locationId: l.locationId,
                delta: -l.remaining,
                txnDate: todayISO(),
                txnRef: `SH-${first.soRef}`,
                transactionId: docId,
              });
            }
          }
        }
      }

      toast.success(`Batch ${kind.replace("_", " ")}(s) created`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ready_to_ship", companyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Ready to pick / ship"
        subtitle="Open sales order lines with real-time stock availability"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={groupBy === "customer" ? "default" : "outline"} onClick={() => setGroupBy("customer")}>
              Group by Customer
            </Button>
            <Button size="sm" variant={groupBy === "location" ? "default" : "outline"} onClick={() => setGroupBy("location")}>
              Group by Location
            </Button>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" disabled={busy || selected.size === 0} onClick={() => void batchCreate("pick_ticket")}>
                  <ClipboardList className="mr-1.5 h-4 w-4" />
                  Create Pick Ticket(s)
                </Button>
                <Button size="sm" disabled={busy || selected.size === 0} onClick={() => void batchCreate("shipment")}>
                  <Truck className="mr-1.5 h-4 w-4" />
                  Create Shipment(s)
                </Button>
              </>
            )}
          </div>
        }
      />

      {q.isLoading && <p className="text-muted-foreground">Loading open order lines…</p>}
      {!q.isLoading && groups.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">No open sales order lines waiting to ship.</div>
      )}

      <div className="space-y-4">
        {groups.map(([grpName, grpLines]) => (
          <div key={grpName} className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 font-medium">{grpName} ({grpLines.length} lines)</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-8 py-1.5" />
                    <th className="py-1.5">SO #</th>
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5">Location</th>
                    <th className="py-1.5 text-right">To Ship</th>
                    <th className="py-1.5 text-right">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {grpLines.map((l) => (
                    <tr key={l.lineId} className="border-b">
                      <td className="py-1.5">
                        <Checkbox
                          checked={selected.has(l.lineId)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(l.lineId);
                            else next.delete(l.lineId);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="py-1.5 font-medium">{l.soRef}</td>
                      <td className="py-1.5">{l.description}</td>
                      <td className="py-1.5">{l.locationName}</td>
                      <td className="py-1.5 text-right">{num(l.remaining, 2)} {l.uom}</td>
                      <td className="py-1.5 text-right">
                        <Badge variant={l.available >= l.remaining ? "secondary" : "destructive"}>
                          {num(l.available, 2)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
