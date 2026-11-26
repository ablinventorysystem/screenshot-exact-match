import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface JobRow {
  id: string;
  job_no: string;
  name: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  wo_count: number;
  total_cost: number;
}

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({
    meta: [
      { title: "Jobs — SOS Inventory" },
      { name: "description", content: "Group work orders and track total job costs." },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase.from("production_jobs").select("*", { count: "exact" }).eq("company_id", companyId);
    if (a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`job_no.ilike.%${a.search}%,name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;

    const jobIds = (data ?? []).map((j) => j.id);
    const { data: wos } = jobIds.length
      ? await supabase.from("transactions").select("job_id, total").in("job_id", jobIds)
      : { data: [] };
    const counts = new Map<string, { n: number; cost: number }>();
    for (const w of wos ?? []) {
      if (!w.job_id) continue;
      const cur = counts.get(w.job_id) ?? { n: 0, cost: 0 };
      counts.set(w.job_id, { n: cur.n + 1, cost: cur.cost + Number(w.total ?? 0) });
    }

    return {
      total: count ?? 0,
      rows: (data ?? []).map((j) => ({
        id: j.id,
        job_no: j.job_no,
        name: j.name,
        status: j.status,
        start_date: j.start_date,
        due_date: j.due_date,
        wo_count: counts.get(j.id)?.n ?? 0,
        total_cost: counts.get(j.id)?.cost ?? 0,
      })) as JobRow[],
    };
  };

  const columns: Column<JobRow>[] = [
    { key: "job_no", header: "Job #", sortable: true, cell: (r) => r.job_no, csv: (r) => r.job_no },
    { key: "name", header: "Job Name", sortable: true, cell: (r) => r.name, csv: (r) => r.name },
    { key: "start", header: "Start", cell: (r) => fmtDate(r.start_date) || "—", csv: (r) => fmtDate(r.start_date) },
    { key: "due", header: "Due", cell: (r) => fmtDate(r.due_date) || "—", csv: (r) => fmtDate(r.due_date) },
    { key: "wos", header: "Work Orders", cell: (r) => r.wo_count, csv: (r) => String(r.wo_count) },
    { key: "cost", header: "Total Cost", cell: (r) => `₱${peso(r.total_cost)}`, csv: (r) => String(r.total_cost) },
    { key: "status", header: "Status", cell: (r) => <Badge variant="outline">{labelize(r.status)}</Badge>, csv: (r) => r.status },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Jobs" subtitle="Group work orders and roll up production costs by project" />
      {companyId && (
        <DataTable<JobRow>
          id="jobs"
          queryKey={["jobs", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "job_no", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "completed", label: "Completed" },
          ]}
          {...(canWrite ? { onAdd: () => setOpen(true) } : {})}
        />
      )}
      <CreateJobDrawer open={open} onOpenChange={setOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["jobs", companyId] })} />
    </div>
  );
}

function CreateJobDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { companyId } = useCompany();
  const [jobNo, setJobNo] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobNo.trim() || !name.trim()) return void toast.error("Job # and name are required");
    setBusy(true);
    try {
      const { error } = await supabase.from("production_jobs").insert({
        company_id: companyId,
        job_no: jobNo.trim(),
        name: name.trim(),
        start_date: startDate || null,
        due_date: dueDate || null,
      });
      if (error) throw error;
      toast.success("Job created");
      setJobNo("");
      setName("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New Production Job</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="jb-no">Job # *</Label>
            <Input id="jb-no" value={jobNo} onChange={(e) => setJobNo(e.target.value)} placeholder="JOB-2026-01" className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="jb-name">Job Name *</Label>
            <Input id="jb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Batch Run Q4" className="mt-1 rounded-md" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="jb-start">Start Date</Label>
              <Input id="jb-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="jb-due">Due Date</Label>
              <Input id="jb-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create Job
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
