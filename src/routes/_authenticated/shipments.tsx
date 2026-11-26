import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";

interface Row { id: string; ref_no: string; txn_date: string; party_name: string | null; notes: string | null; location: string; archived: boolean }

const SORT_COL: Record<string, string> = { ref: "ref_no", date: "txn_date", customer: "party_name" };

export const Route = createFileRoute("/_authenticated/shipments")({
  head: () => ({
    meta: [
      { title: "Shipments — SOS Inventory" },
      { name: "description", content: "Customer shipments and delivery receipts." },
      { property: "og:title", content: "Shipments — SOS Inventory" },
      { property: "og:description", content: "Customer shipments and delivery receipts." },
    ],
  }),
  component: Shipments,
});

function Shipments() {
  const { companyId, canWrite } = useCompany();

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase.from("transactions")
      .select("id, ref_no, txn_date, party_name, notes, archived, location:locations!transactions_location_id_fkey(name)", { count: "exact" })
      .eq("company_id", companyId).eq("type", "shipment");
    if (a.filter !== "all") q = q.eq("archived", a.filter === "archived");
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%,notes.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(SORT_COL[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return {
      total: count ?? 0,
      rows: (data ?? []).map((d) => ({ ...d, location: (d.location as { name: string } | null)?.name ?? "" })) as Row[],
    };
  };

  const setArchived = (archived: boolean) => async (rows: Row[]) => {
    if (!canWrite) return void toast.error("You don't have permission to change shipments");
    const { error } = await supabase.from("transactions").update({ archived }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message); else toast.success(`${rows.length} shipment(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<Row>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "date", header: "Txn date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", sortable: true, cell: (r) => r.party_name, csv: (r) => r.party_name ?? "" },
    { key: "location", header: "Location", cell: (r) => r.location, csv: (r) => r.location },
    { key: "comment", header: "Comment", cell: (r) => r.notes, csv: (r) => r.notes ?? "" },
    { key: "docs", header: "Documents", cell: () => <span className="text-muted-foreground">—</span>, csv: () => "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Shipments" subtitle="showing unarchived shipments" />
      {companyId && (
        <DataTable<Row>
          id="shipments"
          queryKey={["shipments", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[{ value: "unarchived", label: "Unarchived" }, { value: "archived", label: "Archived" }, { value: "all", label: "All" }]}
          batchActions={[{ label: "Archive", onSelect: setArchived(true) }, { label: "Unarchive", onSelect: setArchived(false) }]}
          rowActions={[{ label: "Archive", onSelect: setArchived(true) }, { label: "Unarchive", onSelect: setArchived(false) }]}
          onAdd={() => toast("New shipment form is coming next")}
        />
      )}
    </div>
  );
}
