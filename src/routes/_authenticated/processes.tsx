import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { num, peso } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ProcRow {
  id: string;
  code: string;
  name: string;
  output_qty: number;
  labor_cost: number;
  overhead_cost: number;
  output_item: string;
}

interface ProcLine {
  item_id: string;
  role: "input" | "output" | "co_product" | "by_product";
  qty: number;
  uom: string;
}

export const Route = createFileRoute("/_authenticated/processes")({
  head: () => ({
    meta: [
      { title: "Processes — ABL Inventory" },
      { name: "description", content: "Reusable production BOM processes with inputs, outputs, co/by-products, labor and overhead." },
    ],
  }),
  component: ProcessesPage,
});

function ProcessesPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("production_processes")
      .select("id, code, name, output_qty, labor_cost, overhead_cost, archived", { count: "exact" })
      .eq("company_id", companyId)
      .eq("archived", false);
    if (a.search) q = q.or(`code.ilike.%${a.search}%,name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "code" ? "code" : "name", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return {
      total: count ?? 0,
      rows: (data ?? []).map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        output_qty: Number(d.output_qty),
        labor_cost: Number(d.labor_cost),
        overhead_cost: Number(d.overhead_cost),
        output_item: "—",
      })),
    };
  };

  const columns: Column<ProcRow>[] = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => { setEditId(r.id); setDrawerOpen(true); }}>
          {r.code}
        </button>
      ),
      csv: (r) => r.code,
    },
    { key: "name", header: "Process Name", sortable: true, cell: (r) => r.name, csv: (r) => r.name },
    { key: "qty", header: "Output Qty", cell: (r) => num(r.output_qty, 2), csv: (r) => String(r.output_qty) },
    { key: "labor", header: "Labor Cost", cell: (r) => `₱${peso(r.labor_cost)}`, csv: (r) => String(r.labor_cost) },
    { key: "overhead", header: "Overhead", cell: (r) => `₱${peso(r.overhead_cost)}`, csv: (r) => String(r.overhead_cost) },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Processes" subtitle="Reusable production BOMs with inputs, outputs, co/by-products, and labor/overhead" />
      {companyId && (
        <DataTable<ProcRow>
          id="processes"
          queryKey={["processes", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "code", dir: "asc" }}
          rowActions={[{ label: "Edit process", onSelect: (rows) => { if (rows[0]) { setEditId(rows[0].id); setDrawerOpen(true); } } }]}
          {...(canWrite ? { onAdd: () => { setEditId(null); setDrawerOpen(true); } } : {})}
        />
      )}
      <ProcessDrawer
        open={drawerOpen}
        processId={editId}
        onOpenChange={setDrawerOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ["processes", companyId] })}
      />
    </div>
  );
}

function ProcessDrawer({
  open,
  processId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  processId: string | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { companyId } = useCompany();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [laborCost, setLaborCost] = useState("0");
  const [overheadCost, setOverheadCost] = useState("0");
  const [lines, setLines] = useState<ProcLine[]>([]);
  const [busy, setBusy] = useState(false);

  const itemsQ = useQuery({
    queryKey: ["proc_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, uom").eq("company_id", companyId).eq("archived", false).order("name").limit(400);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (!processId) {
      setCode("");
      setName("");
      setOutputItemId("");
      setOutputQty("1");
      setLaborCost("0");
      setOverheadCost("0");
      setLines([]);
      return;
    }
    const load = async () => {
      const { data: p } = await supabase.from("production_processes").select("*").eq("id", processId).single();
      const { data: ls } = await supabase.from("production_process_lines").select("*").eq("process_id", processId);
      if (p) {
        setCode(p.code);
        setName(p.name);
        setOutputItemId(p.output_item_id ?? "");
        setOutputQty(String(p.output_qty));
        setLaborCost(String(p.labor_cost));
        setOverheadCost(String(p.overhead_cost));
      }
      setLines((ls ?? []).map((l) => ({ item_id: l.item_id, role: l.role as ProcLine["role"], qty: Number(l.qty), uom: l.uom ?? "pc" })));
    };
    void load();
  }, [open, processId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return void toast.error("Code and name are required");
    setBusy(true);
    try {
      let pid = processId;
      const payload = {
        company_id: companyId,
        code: code.trim(),
        name: name.trim(),
        output_item_id: outputItemId || null,
        output_qty: Number(outputQty) || 1,
        labor_cost: Number(laborCost) || 0,
        overhead_cost: Number(overheadCost) || 0,
      };
      if (pid) {
        const { error } = await supabase.from("production_processes").update(payload).eq("id", pid);
        if (error) throw error;
        await supabase.from("production_process_lines").delete().eq("process_id", pid);
      } else {
        const { data, error } = await supabase.from("production_processes").insert(payload).select("id").single();
        if (error) throw error;
        pid = data.id;
      }

      if (lines.length > 0 && pid) {
        const { error: lErr } = await supabase.from("production_process_lines").insert(
          lines.map((l) => ({
            company_id: companyId,
            process_id: pid!,
            item_id: l.item_id,
            role: l.role,
            qty: l.qty,
            uom: l.uom,
          })),
        );
        if (lErr) throw lErr;
      }

      toast.success("Process saved");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save process");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{processId ? "Edit Process" : "New Production Process"}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pr-code">Code *</Label>
              <Input id="pr-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PROC-01" className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="pr-name">Name *</Label>
              <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Assembly Line A" className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="pr-out">Primary Output Item</Label>
              <select id="pr-out" value={outputItemId} onChange={(e) => setOutputItemId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-2 text-sm">
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="pr-qty">Output Qty (batch)</Label>
              <Input id="pr-qty" type="number" step="any" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="pr-labor">Labor Cost (₱)</Label>
              <Input id="pr-labor" type="number" step="any" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="pr-oh">Overhead Cost (₱)</Label>
              <Input id="pr-oh" type="number" step="any" value={overheadCost} onChange={(e) => setOverheadCost(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="section-label">BOM Lines (Inputs / Co-Products / By-Products)</span>
              <select
                aria-label="Add BOM line"
                value=""
                onChange={(e) => {
                  const it = (itemsQ.data ?? []).find((x) => x.id === e.target.value);
                  if (!it) return;
                  setLines((p) => [...p, { item_id: it.id, role: "input", qty: 1, uom: it.uom }]);
                }}
                className="h-8 rounded-md border bg-surface px-2 text-xs"
              >
                <option value="">+ Add item…</option>
                {(itemsQ.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
              </select>
            </div>

            {lines.map((l, idx) => {
              const it = (itemsQ.data ?? []).find((x) => x.id === l.item_id);
              return (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-md border bg-surface p-2 text-xs">
                  <span className="min-w-[140px] flex-1 font-medium">{it ? `${it.sku} — ${it.name}` : l.item_id}</span>
                  <select
                    value={l.role}
                    onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, role: e.target.value as ProcLine["role"] } : x)))}
                    className="h-7 rounded-md border bg-card px-2"
                  >
                    <option value="input">Input</option>
                    <option value="output">Output</option>
                    <option value="co_product">Co-product</option>
                    <option value="by_product">By-product</option>
                  </select>
                  <Input
                    type="number"
                    step="0.000001"
                    value={l.qty}
                    onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) || 0 } : x)))}
                    className="h-7 w-24 rounded-md text-right"
                  />
                  <Badge variant="outline">{l.uom}</Badge>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" />
              Save Process
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
