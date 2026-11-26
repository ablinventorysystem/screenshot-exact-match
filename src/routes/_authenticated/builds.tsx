import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory } from "lucide-react";
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

interface BuildRow {
  id: string;
  ref_no: string;
  txn_date: string;
  status: string;
  total: number;
  notes: string | null;
}

export const Route = createFileRoute("/_authenticated/builds")({
  validateSearch: (s: Record<string, unknown>) => ({
    woId: typeof s["woId"] === "string" ? s["woId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Builds — SOS Inventory" },
      { name: "description", content: "Execute builds, consume component lots/serials, produce finished lots, and record genealogy." },
    ],
  }),
  component: BuildsPage,
});

function BuildsPage() {
  const { woId } = Route.useSearch();
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(!!woId);

  useEffect(() => {
    if (woId) setDrawerOpen(true);
  }, [woId]);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, status, total, notes", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "build");
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,notes.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as BuildRow[], total: count ?? 0 };
  };

  const columns: Column<BuildRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Build Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "status", header: "Status", cell: (r) => <Badge variant="secondary">{labelize(r.status)}</Badge>, csv: (r) => r.status },
    { key: "cost", header: "Total Cost", cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "—", csv: (r) => r.notes ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Builds" subtitle="Consume components by lot/serial, produce finished goods with lot genealogy & cost roll-up" />
      {companyId && (
        <DataTable<BuildRow>
          id="builds"
          queryKey={["builds", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <CreateBuildDrawer
        open={drawerOpen}
        initialWoId={woId}
        onOpenChange={setDrawerOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["builds", companyId] })}
      />
    </div>
  );
}

function CreateBuildDrawer({
  open,
  initialWoId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  initialWoId: string | undefined;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { companyId } = useCompany();
  const [processId, setProcessId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [outputLotNo, setOutputLotNo] = useState(`FG-${todayISO().replace(/-/g, "")}`);
  const [outputExpiry, setOutputExpiry] = useState("");
  const [compLotMap, setCompLotMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const procsQ = useQuery({
    queryKey: ["bld_procs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("production_processes").select("*").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const procLinesQ = useQuery({
    queryKey: ["bld_proc_lines", processId],
    enabled: !!processId,
    queryFn: async () => {
      const { data } = await supabase.from("production_process_lines").select("*, item:items(id, sku, name, cost, tracking)").eq("process_id", processId);
      return data ?? [];
    },
  });

  const lotsQ = useQuery({
    queryKey: ["bld_lots", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("item_lots").select("id, item_id, lot_no").eq("company_id", companyId).order("expiry_date", { ascending: true });
      return data ?? [];
    },
  });

  const locsQ = useQuery({
    queryKey: ["bld_locs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, is_default").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!initialWoId || !open) return;
    const loadWo = async () => {
      const { data } = await supabase.from("transactions").select("process_id, location_id").eq("id", initialWoId).single();
      if (data?.process_id) setProcessId(data.process_id);
      if (data?.location_id) setLocationId(data.location_id);
    };
    void loadWo();
  }, [initialWoId, open]);

  useEffect(() => {
    if (!locationId && locsQ.data?.length) {
      const def = locsQ.data.find((l) => l.is_default) ?? locsQ.data[0];
      if (def) setLocationId(def.id);
    }
  }, [locationId, locsQ.data]);

  const handleBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    const proc = (procsQ.data ?? []).find((p) => p.id === processId);
    if (!proc || !locationId) return void toast.error("Select a process and location");
    setBusy(true);
    try {
      const pLines = procLinesQ.data ?? [];
      const inputs = pLines.filter((l) => l.role === "input");
      const outputs = pLines.filter((l) => l.role !== "input");

      const materialCost = inputs.reduce((s, l) => {
        const it = l.item as unknown as { cost: number } | null;
        return s + Number(l.qty) * Number(it?.cost ?? 0);
      }, 0);
      const totalCost = materialCost + Number(proc.labor_cost) + Number(proc.overhead_cost);
      const unitOutCost = Number(proc.output_qty) > 0 ? totalCost / Number(proc.output_qty) : totalCost;

      const { data: buildId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "build",
          status: "completed",
          txn_date: todayISO(),
          location_id: locationId,
          parent_txn_id: initialWoId || null,
          process_id: proc.id,
          total: totalCost,
          notes: `Build for ${proc.code} — ${proc.name}`,
          lines: pLines.map((l) => {
            const it = l.item as unknown as { sku: string; name: string; cost: number } | null;
            return {
              item_id: l.item_id,
              description: `${l.role.toUpperCase()}: ${it?.sku ?? ""} — ${it?.name ?? ""}`,
              qty: Number(l.qty),
              uom: l.uom,
              rate: Number(it?.cost ?? 0),
              amount: Number(l.qty) * Number(it?.cost ?? 0),
              lot_id: compLotMap[l.id] || null,
            };
          }),
        },
      });
      if (error) throw error;

      // Consume inputs
      for (const inp of inputs) {
        await adjustInventoryLevel({
          companyId,
          itemId: inp.item_id,
          locationId,
          lotId: compLotMap[inp.id] || null,
          delta: -Number(inp.qty),
          txnDate: todayISO(),
          txnRef: `BLD-${proc.code}`,
          transactionId: buildId,
        });
      }

      // Create finished good lot if primary output item is set
      let fgLotId: string | null = null;
      if (proc.output_item_id && outputLotNo.trim()) {
        const { data: lotRow } = await supabase
          .from("item_lots")
          .insert({
            company_id: companyId,
            item_id: proc.output_item_id,
            lot_no: outputLotNo.trim(),
            received_date: todayISO(),
            expiry_date: outputExpiry || null,
          })
          .select("id")
          .single();
        fgLotId = lotRow?.id ?? null;

        await adjustInventoryLevel({
          companyId,
          itemId: proc.output_item_id,
          locationId,
          lotId: fgLotId,
          delta: Number(proc.output_qty),
          unitCost: unitOutCost,
          txnDate: todayISO(),
          txnRef: `BLD-${proc.code}`,
          transactionId: buildId,
        });
      }

      // Produce co/by-products
      for (const out of outputs) {
        await adjustInventoryLevel({
          companyId,
          itemId: out.item_id,
          locationId,
          delta: Number(out.qty),
          txnDate: todayISO(),
          txnRef: `BLD-${proc.code}`,
          transactionId: buildId,
        });
      }

      // Record lot genealogy for Trace page
      if (fgLotId) {
        const genRows = inputs
          .filter((inp) => compLotMap[inp.id])
          .map((inp) => ({
            company_id: companyId,
            parent_lot_id: compLotMap[inp.id]!,
            child_lot_id: fgLotId,
            build_txn_id: buildId,
            qty: Number(inp.qty),
          }));
        if (genRows.length > 0) await supabase.from("lot_genealogy").insert(genRows);
      }

      if (initialWoId) {
        await supabase.from("transactions").update({ status: "completed" }).eq("id", initialWoId);
      }

      toast.success("Build posted & lot genealogy recorded");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post build");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Execute Production Build</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleBuild} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bld-proc">Process *</Label>
              <select id="bld-proc" value={processId} onChange={(e) => setProcessId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-2 text-sm">
                <option value="">Select process…</option>
                {(procsQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="bld-loc">Location *</Label>
              <select id="bld-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-2 text-sm">
                <option value="">Select location…</option>
                {(locsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="bld-lot">Finished Good Lot #</Label>
              <Input id="bld-lot" value={outputLotNo} onChange={(e) => setOutputLotNo(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="bld-exp">Finished Good Expiry</Label>
              <Input id="bld-exp" type="date" value={outputExpiry} onChange={(e) => setOutputExpiry(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <span className="section-label">Component Lots to Consume</span>
            {(procLinesQ.data ?? []).filter((l) => l.role === "input").map((l) => {
              const it = l.item as unknown as { sku: string; name: string } | null;
              const itemLots = (lotsQ.data ?? []).filter((lt) => lt.item_id === l.item_id);
              return (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border bg-surface p-2 text-sm">
                  <span>{it?.sku} — {it?.name} ({l.qty} {l.uom})</span>
                  <select
                    value={compLotMap[l.id] ?? ""}
                    onChange={(e) => setCompLotMap({ ...compLotMap, [l.id]: e.target.value })}
                    className="h-8 rounded-md border bg-card px-2 text-xs"
                  >
                    <option value="">No specific lot</option>
                    {itemLots.map((lt) => <option key={lt.id} value={lt.id}>{lt.lot_no}</option>)}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <Factory className="mr-1.5 h-4 w-4" />
              Post Build
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
