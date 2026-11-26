import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface WoRow {
  id: string;
  ref_no: string;
  txn_date: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  location: string;
}

export const Route = createFileRoute("/_authenticated/work-orders")({
  head: () => ({
    meta: [
      { title: "Work orders — SOS Inventory" },
      { name: "description", content: "Production work orders from processes or sales orders." },
    ],
  }),
  component: WorkOrdersPage,
});

function WorkOrdersPage() {
  const { companyId, canWrite } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, due_date, status, notes, location:locations!transactions_location_id_fkey(name)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "work_order");
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
        due_date: d.due_date,
        status: d.status,
        notes: d.notes,
        location: (d.location as unknown as { name: string } | null)?.name ?? "—",
      })),
    };
  };

  const updateStatus = (status: string) => async (rows: WoRow[]) => {
    if (!canWrite) return void toast.error("Read-only users cannot update work orders");
    const { error } = await supabase.from("transactions").update({ status }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`Updated to ${labelize(status)}`);
  };

  const columns: Column<WoRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Start Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "due", header: "Due Date", cell: (r) => fmtDate(r.due_date) || "—", csv: (r) => fmtDate(r.due_date) },
    { key: "location", header: "Location", cell: (r) => r.location, csv: (r) => r.location },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.status === "completed" ? "secondary" : "outline"}>{labelize(r.status)}</Badge>,
      csv: (r) => r.status,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "—", csv: (r) => r.notes ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Work orders" subtitle="Schedule production runs from processes or sales orders" />
      {companyId && (
        <DataTable<WoRow>
          id="work_orders"
          queryKey={["work_orders", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "completed", label: "Completed" },
          ]}
          rowActions={[
            { label: "Mark In progress", onSelect: updateStatus("in_progress") },
            { label: "Mark Completed", onSelect: updateStatus("completed") },
            { label: "Create Build", onSelect: (rows) => rows[0] && void navigate({ to: "/builds", search: { woId: rows[0].id } as never }) },
          ]}
          {...(canWrite ? { onAdd: () => setCreateOpen(true) } : {})}
        />
      )}
      <CreateWoDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["work_orders", companyId] })}
      />
    </div>
  );
}

function CreateWoDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { companyId } = useCompany();
  const [processId, setProcessId] = useState("");
  const [jobId, setJobId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const procsQ = useQuery({
    queryKey: ["wo_procs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("production_processes").select("id, code, name, output_item_id, output_qty").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["wo_jobs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("production_jobs").select("id, job_no, name").eq("company_id", companyId).in("status", ["open", "in_progress"]);
      return data ?? [];
    },
  });

  const locsQ = useQuery({
    queryKey: ["wo_locs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!processId) return void toast.error("Select a production process");
    setBusy(true);
    try {
      const proc = (procsQ.data ?? []).find((p) => p.id === processId);
      const { data: procLines } = await supabase.from("production_process_lines").select("*, item:items(sku, name, cost)").eq("process_id", processId);
      const mult = Number(qty) || 1;
      const { error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: companyId,
          type: "work_order",
          status: "open",
          txn_date: todayISO(),
          due_date: dueDate || null,
          location_id: locationId || null,
          process_id: processId,
          job_id: jobId || null,
          notes: notes.trim() || `${proc?.code ?? ""} ${proc?.name ?? ""}`.trim(),
          lines: (procLines ?? []).map((l) => {
            const it = l.item as unknown as { sku: string; name: string; cost: number } | null;
            return {
              item_id: l.item_id,
              description: `${l.role.toUpperCase()}: ${it?.sku ?? ""} — ${it?.name ?? ""}`,
              qty: Number(l.qty) * mult,
              uom: l.uom,
              rate: Number(it?.cost ?? 0),
              amount: Number(l.qty) * mult * Number(it?.cost ?? 0),
            };
          }),
        },
      });
      if (error) throw error;
      toast.success("Work Order created");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create Work Order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New Work Order</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="wo-proc">Process (BOM) *</Label>
            <select id="wo-proc" value={processId} onChange={(e) => setProcessId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select process…</option>
              {(procsQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="wo-job">Job (optional)</Label>
            <select id="wo-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">No job</option>
              {(jobsQ.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.job_no} — {j.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="wo-loc">Facility / Location</Label>
            <select id="wo-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select location…</option>
              {(locsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wo-qty">Batch Multiplier</Label>
              <Input id="wo-qty" type="number" step="any" min="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="wo-due">Due Date</Label>
              <Input id="wo-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>
          <div>
            <Label htmlFor="wo-notes">Notes</Label>
            <Input id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <Hammer className="mr-1.5 h-4 w-4" />
              Create Work Order
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
